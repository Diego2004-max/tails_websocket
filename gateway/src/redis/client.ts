import Redis from 'ioredis';
import { config } from '../config';
import { APPLY_SHEET, READ_SNAPSHOT, RELEASE_LOCK, RENEW_LOCK } from './scripts';

type Arg = string | number;

export interface ScriptedRedis extends Redis {
  applySheet(...args: Arg[]): Promise<string>;
  readSnapshot(...args: Arg[]): Promise<[string[], string[], string]>;
  renewLock(...args: Arg[]): Promise<number>;
  releaseLock(...args: Arg[]): Promise<number>;
}

/**
 * "command" clients fail fast when Redis is down (no offline queue): a juror must get an
 * explicit UNAVAILABLE instead of a hanging request. The "subscriber" client keeps its
 * queue and re-subscribes automatically after a reconnect.
 */
export function createRedis(role: 'command' | 'subscriber'): ScriptedRedis {
  const client = new Redis(config.redisUrl, {
    enableOfflineQueue: role === 'subscriber',
    maxRetriesPerRequest: role === 'command' ? 1 : null,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    connectTimeout: 3000,
  }) as ScriptedRedis;

  client.on('error', (err) => console.error(`[redis:${role}]`, err.message));

  if (role === 'command') {
    client.defineCommand('applySheet', { numberOfKeys: 12, lua: APPLY_SHEET });
    client.defineCommand('readSnapshot', { numberOfKeys: 3, lua: READ_SNAPSHOT });
    client.defineCommand('renewLock', { numberOfKeys: 1, lua: RENEW_LOCK });
    client.defineCommand('releaseLock', { numberOfKeys: 1, lua: RELEASE_LOCK });
  }
  return client;
}

export const isRedisReady = (r: Redis): boolean => r.status === 'ready';
