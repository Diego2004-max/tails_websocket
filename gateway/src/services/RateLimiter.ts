import { config } from '../config';
import type { ScriptedRedis } from '../redis/client';
import { keys } from '../redis/keys';

export interface RateDecision {
  allowed: boolean;
  retryAfterSec: number;
}

/** Fixed-window counter per credential, shared by all instances through Redis. */
export class RateLimiter {
  constructor(private readonly redis: ScriptedRedis) {}

  async hit(credential: string): Promise<RateDecision> {
    const { windowSec, max } = config.rateLimit;
    const nowSec = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSec / windowSec);
    const key = keys.rate(credential, window);
    try {
      const res = await this.redis.multi().incr(key).expire(key, windowSec * 2, 'NX').exec();
      const used = Number(res?.[0]?.[1] ?? 0);
      if (used <= max) return { allowed: true, retryAfterSec: 0 };
      return { allowed: false, retryAfterSec: windowSec - (nowSec % windowSec) };
    } catch {
      return { allowed: true, retryAfterSec: 0 }; // fail-open: ingestion itself reports Redis failures
    }
  }
}
