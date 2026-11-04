import type { PresenceEntry } from '../../../../shared/protocol';
import { config } from '../../platform/config';
import type { ScriptedRedis } from '../../platform/redis/client';
import { keys } from '../../platform/redis/keys';

/**
 * Presence = heartbeat + TTL. Each heartbeat rewrites a small key with EX and bumps a ZSET
 * score to "expires at". A dead connection stops heartbeating, so the entry vanishes by itself:
 * no ghost auditors, and no cleanup job that could itself fail.
 */
export class PresenceService {
  constructor(private readonly redis: ScriptedRedis) {}

  async beat(entry: PresenceEntry): Promise<void> {
    const expiresAt = Date.now() + config.presenceTtlSec * 1000;
    await this.redis
      .multi()
      .set(keys.presence(entry.auditorId), JSON.stringify(entry), 'EX', config.presenceTtlSec)
      .zadd(keys.presenceIndex, expiresAt, entry.auditorId)
      .exec();
  }

  async remove(auditorId: string): Promise<void> {
    await this.redis.multi().del(keys.presence(auditorId)).zrem(keys.presenceIndex, auditorId).exec();
  }

  async list(): Promise<PresenceEntry[]> {
    const now = Date.now();
    await this.redis.zremrangebyscore(keys.presenceIndex, '-inf', now);
    const ids = await this.redis.zrangebyscore(keys.presenceIndex, now, '+inf');
    if (ids.length === 0) return [];
    const raws = await this.redis.mget(ids.map(keys.presence));
    return raws.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as PresenceEntry);
  }
}
