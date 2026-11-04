import { z } from 'zod';
import { balances, GEOGRAPHY, sheetIdOf, sumVotes, VOTE_KEYS, type Votes } from '../../../../shared/domain';
import type { AckStatus, SheetSubmission } from '../../../../shared/protocol';
import { config } from '../../platform/config';
import type { ScriptedRedis } from '../../platform/redis/client';
import { keys } from '../../platform/redis/keys';

const count = z.number().int().min(0).max(5000);
export const submissionSchema = z.object({
  sheetId: z.string().regex(/^E14-\d{1,4}-\d{4}-\d{2}$/),
  table: z.number().int().min(1).max(GEOGRAPHY.tables),
  station: z.number().int().min(1).max(GEOGRAPHY.stations),
  municipality: z.number().int().min(1).max(GEOGRAPHY.municipalities),
  version: z.number().int().min(1).max(50),
  jurorId: z.string().min(3).max(32),
  closedAt: z.number().int(),
  votes: z.object({ C1: count, C2: count, C3: count, BLANK: count, NULL: count, UNMARKED: count }),
  voters: count,
  photoHash: z.string().min(4).max(128),
  idempotencyKey: z.string().min(8).max(64),
}).refine((s) => s.sheetId === sheetIdOf(s.station, s.table), { message: 'acta id must be E14-{puesto}-{mesa}-03' });

export class UnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Redis unavailable');
    this.cause = cause;
  }
}

export interface IngestResult {
  status: AckStatus;
  version: number;
}

/** Read model of one stored sheet. Owned by this module; other modules never see Redis keys. */
export interface StoredSheet {
  table: number;
  station: number;
  municipality: number;
  version: number;
  voters: number;
  votes: Votes;
}

export interface SheetIngest {
  ingest(input: SheetSubmission): Promise<IngestResult>;
}

export interface SheetQuery {
  read(sheetId: string): Promise<StoredSheet | null>;
  readMany(ids: string[]): Promise<Map<string, StoredSheet>>;
}

export type SheetStore = SheetIngest & SheetQuery;

/**
 * Single responsibility: turn a validated submission into one atomic Redis operation.
 * Idempotency, versioning and aggregation are decided INSIDE the Lua script, so a crash
 * between "registered" and "acknowledged" is harmless: the retry returns the same answer.
 */
export class SheetService {
  constructor(private readonly redis: ScriptedRedis) {}

  async ingest(input: SheetSubmission, onIngested?: () => void): Promise<IngestResult> {
    const { table, station, municipality } = input;
    const flagged = !balances(input.votes, input.voters);
    const priority = Math.abs(sumVotes(input.votes) - input.voters);

    try {
      const raw = await this.redis.applySheet(
        // KEYS
        keys.idem(input.idempotencyKey),
        keys.sheet(input.sheetId),
        keys.agg('tbl', table),
        keys.agg('pst', station),
        keys.agg('mun', municipality),
        keys.agg('dept', 1),
        keys.rank('pst', station),
        keys.rank('mun', municipality),
        keys.rank('dept', 1),
        keys.events,
        keys.lastId,
        keys.queue,
        // ARGV
        input.version,
        JSON.stringify(pickVotes(input.votes)),
        flagged ? '1' : '0',
        input.voters,
        table,
        station,
        municipality,
        Date.now(),
        config.idempotencyTtlSec,
        input.sheetId,
        priority,
        config.streamMaxLen,
        keys.channel.topic('dept'),
        keys.channel.topic(`mun:${municipality}`),
        keys.channel.topic(`pst:${station}`),
        keys.channel.queue,
        input.jurorId,
      );
      onIngested?.();
      return JSON.parse(raw) as IngestResult;
    } catch (err) {
      throw new UnavailableError(err);
    }
  }

  async read(sheetId: string): Promise<StoredSheet | null> {
    try {
      const rec = await this.redis.hgetall(keys.sheet(sheetId));
      return parseStored(rec);
    } catch (err) {
      throw new UnavailableError(err);
    }
  }

  async readMany(ids: string[]): Promise<Map<string, StoredSheet>> {
    const out = new Map<string, StoredSheet>();
    if (ids.length === 0) return out;
    try {
      const pipe = this.redis.pipeline();
      for (const id of ids) pipe.hgetall(keys.sheet(id));
      const res = (await pipe.exec()) ?? [];
      ids.forEach((id, i) => {
        const rec = (res[i]?.[1] ?? {}) as Record<string, string>;
        const parsed = parseStored(rec);
        if (parsed) out.set(id, parsed);
      });
      return out;
    } catch (err) {
      throw new UnavailableError(err);
    }
  }
}

function parseStored(rec: Record<string, string> | null | undefined): StoredSheet | null {
  if (!rec?.table) return null;
  return {
    table: Number(rec.table),
    station: Number(rec.station),
    municipality: Number(rec.municipality),
    version: Number(rec.version),
    voters: Number(rec.voters),
    votes: JSON.parse(rec.votes ?? '{}') as Votes,
  };
}

function pickVotes(v: Votes): Votes {
  return Object.fromEntries(VOTE_KEYS.map((k) => [k, v[k]])) as Votes;
}
