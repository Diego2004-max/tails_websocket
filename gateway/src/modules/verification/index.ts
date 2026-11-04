import type { WebSocket } from 'ws';
import type { PresenceEntry } from '../../../../shared/protocol';
import type { RuntimeMetrics } from '../../platform/metrics/Metrics';
import type { RateGate } from '../../platform/rate-limit/RateLimiter';
import type { ScriptedRedis } from '../../platform/redis/client';
import type { SheetStore } from '../sheets';
import { AuditHub } from './AuditHub';
import { LockService } from './LockService';
import { PresenceService } from './PresenceService';
import { QueueService } from './QueueService';

/**
 * Auditors. WebSocket stays inside the module. The only HTTP read is presence,
 * exposed as a method so the router does not grow a controller for one GET.
 */
export interface VerificationModule {
  attach(ws: WebSocket, url: URL): void;
  scheduleBroadcast(): void;
  listPresence(): Promise<PresenceEntry[]>;
}

export function createVerification(
  redis: ScriptedRedis,
  sheets: SheetStore,
  limiter: RateGate,
  metrics: RuntimeMetrics,
): VerificationModule {
  const locks = new LockService(redis);
  const presence = new PresenceService(redis);
  const queue = new QueueService(redis, sheets);
  const hub = new AuditHub(locks, presence, sheets, limiter, metrics, queue);
  return {
    attach: (ws, url) => hub.attach(ws, url),
    scheduleBroadcast: () => hub.scheduleBroadcast(),
    listPresence: () => presence.list(),
  };
}
