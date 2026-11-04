import { z } from 'zod';
import { balances, locate, sumVotes, VOTE_KEYS, type Votes } from '../../../shared/domain';
import type { AckStatus, SheetSubmission } from '../../../shared/protocol';
import { config } from '../config';
import type { ScriptedRedis } from '../redis/client';
import { keys } from '../redis/keys';

const count = z.number().int().min(0).max(5000);
export const submissionSchema = z.object({
  sheetId: z.string().regex(/^E14-\d{4}-\d{4}-\d{2}$/),
  table: z.number().int().min(1).max(6400),
  version: z.number().int().min(1).max(50),
  jurorId: z.string().min(3).max(32),
  closedAt: z.number().int(),
  votes: z.object({ C1: count, C2: count, C3: count, BLANK: count, NULL: count, UNMARKED: count }),
  voters: count,
  photoHash: z.string().min(4).max(128),
  idempotencyKey: z.string().min(8).max(64),
});

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

/**
 * Single responsibility: turn a validated submission into one atomic Redis operation.
 * Idempotency, versioning and aggregation are decided INSIDE the Lua script, so a crash
 * between "registered" and "acknowledged" is harmless: the retry returns the same answer.
 */
export class SheetService {
  constructor(private readonly redis: ScriptedRedis) {}

  async ingest(input: SheetSubmission, onIngested?: () => void): Promise<IngestResult> {
    const { table, station, municipality } = locate(input.table);
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

  async currentVersion(sheetId: string): Promise<number> {
    try {
      return Number((await this.redis.hget(keys.sheet(sheetId), 'version')) ?? 0);
    } catch (err) {
      throw new UnavailableError(err);
    }
  }
}

function pickVotes(v: Votes): Votes {
  return Object.fromEntries(VOTE_KEYS.map((k) => [k, v[k]])) as Votes;
}
