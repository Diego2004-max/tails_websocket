import { CANDIDATES, GEOGRAPHY, locate, parseTopic, type Topic, VOTE_KEYS } from '../../../../shared/domain';
import type { Snapshot } from '../../../../shared/protocol';
import type { ScriptedRedis } from '../../platform/redis/client';
import { keys } from '../../platform/redis/keys';

const LEVEL_KEY = { dept: 'dept', mun: 'mun', pst: 'pst' } as const;

/** Reads the current aggregate for a topic together with the stream id it corresponds to. */
export class SnapshotService {
  constructor(private readonly redis: ScriptedRedis) {}

  async read(topic: Topic): Promise<Snapshot> {
    const parsed = parseTopic(topic);
    if (!parsed) throw new Error('invalid topic');
    const level = LEVEL_KEY[parsed.level];

    const [flat, , lastId] = await this.redis.readSnapshot(
      keys.agg(level, parsed.id),
      keys.rank(level, parsed.id),
      keys.lastId,
    );
    const hash: Record<string, number> = {};
    for (let i = 0; i < flat.length; i += 2) hash[flat[i]] = Number(flat[i + 1]);

    const totals: Record<string, number> = {};
    for (const k of [...VOTE_KEYS, 'voters', 'tables']) totals[k] = hash[k] ?? 0;

    return {
      topic,
      id: lastId,
      totals,
      tablesTotal: hash.tablesTotal ?? 0,
      ranking: CANDIDATES.map((c) => ({ candidate: c, votes: totals[c] })).sort((a, b) => b.votes - a.votes),
    };
  }

  /** Idempotent: writes the same totals every time. Safe to run from every instance. */
  async seedTotals(): Promise<void> {
    const perStation = new Map<number, number>();
    const perMunicipality = new Map<number, number>();
    for (let t = 1; t <= GEOGRAPHY.tables; t++) {
      const l = locate(t);
      perStation.set(l.station, (perStation.get(l.station) ?? 0) + 1);
      perMunicipality.set(l.municipality, (perMunicipality.get(l.municipality) ?? 0) + 1);
    }
    const pipe = this.redis.pipeline();
    pipe.hset(keys.agg('dept', 1), 'tablesTotal', GEOGRAPHY.tables);
    for (const [id, n] of perStation) pipe.hset(keys.agg('pst', id), 'tablesTotal', n);
    for (const [id, n] of perMunicipality) pipe.hset(keys.agg('mun', id), 'tablesTotal', n);
    await pipe.exec();
  }
}
