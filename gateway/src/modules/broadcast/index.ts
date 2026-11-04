import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Topic } from '../../../../shared/domain';
import type { Snapshot } from '../../../../shared/protocol';
import type { Backplane } from '../../platform/bus/Backplane';
import type { RuntimeMetrics } from '../../platform/metrics/Metrics';
import type { ScriptedRedis } from '../../platform/redis/client';
import { HistoryService } from './HistoryService';
import { PublicHub } from './PublicHub';
import { SnapshotService } from './SnapshotService';

/**
 * Public audience. SSE and the polling snapshot are adapters of this module.
 * There is no controller: a long-lived stream is not a request/response action.
 */
export interface BroadcastModule {
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
  readSnapshot(topic: Topic): Promise<Snapshot>;
  seedTotals(): Promise<void>;
  setDegraded(value: boolean): Promise<void>;
  shutdown(): Promise<void>;
}

export function createBroadcast(backplane: Backplane, redis: ScriptedRedis, metrics: RuntimeMetrics): BroadcastModule {
  const snapshots = new SnapshotService(redis);
  const history = new HistoryService(redis);
  const hub = new PublicHub(backplane, snapshots, history, metrics);
  return {
    handle: (req, res, url) => hub.handle(req, res, url),
    readSnapshot: (topic) => snapshots.read(topic),
    seedTotals: () => snapshots.seedTotals(),
    setDegraded: (value) => hub.setDegraded(value),
    shutdown: () => hub.shutdown(),
  };
}
