import { randomUUID } from 'node:crypto';
import { config } from '../../platform/config';
import type { ScriptedRedis } from '../../platform/redis/client';
import { keys } from '../../platform/redis/keys';

export type TakeResult = { ok: true; token: string } | { ok: false; heldBy: string | null };

/**
 * Distributed lock with owner token + TTL (RF-7).
 *  - acquire: SET NX PX         -> only one winner, across all instances.
 *  - renew:   compare token, then PEXPIRE (Lua) -> a short TTL that stays alive while the
 *             auditor is really working, and dies by itself when the owner disappears.
 *  - release: compare token, then DEL (Lua)     -> a late owner can never free someone else's lock.
 */
export class LockService {
  constructor(private readonly redis: ScriptedRedis) {}

  async acquire(sheetId: string, auditorId: string): Promise<TakeResult> {
    const token = `${auditorId}:${randomUUID()}`;
    const ok = await this.redis.set(keys.lock(sheetId), token, 'PX', config.lock.ttlMs, 'NX');
    if (ok === 'OK') return { ok: true, token };
    return { ok: false, heldBy: ownerOf(await this.redis.get(keys.lock(sheetId))) };
  }

  async renew(sheetId: string, token: string): Promise<boolean> {
    return (await this.redis.renewLock(keys.lock(sheetId), token, config.lock.ttlMs)) === 1;
  }

  async release(sheetId: string, token: string): Promise<boolean> {
    return (await this.redis.releaseLock(keys.lock(sheetId), token)) === 1;
  }

  async isOwner(sheetId: string, token: string): Promise<boolean> {
    return (await this.redis.get(keys.lock(sheetId))) === token;
  }
}

export const ownerOf = (token: string | null): string | null => (token ? token.split(':')[0] : null);
