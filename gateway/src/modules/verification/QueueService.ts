import type { Votes } from '../../../../shared/domain';
import type { QueueItem } from '../../../../shared/protocol';
import type { ScriptedRedis } from '../../platform/redis/client';
import { keys } from '../../platform/redis/keys';
import type { SheetQuery } from '../sheets';
import { ownerOf } from './LockService';

const EMPTY_VOTES = {} as Votes;

/**
 * The doubtful-sheet queue. The hub asks this service; it does not know Redis keys.
 * Membership is written atomically by the sheets script. This module only reads it
 * and announces that it changed.
 */
export class QueueService {
  constructor(
    private readonly redis: ScriptedRedis,
    private readonly sheets: SheetQuery,
  ) {}

  async contains(sheetId: string): Promise<boolean> {
    return (await this.redis.zscore(keys.queue, sheetId)) !== null;
  }

  notifyChanged(): Promise<unknown> {
    return this.redis.publish(keys.channel.queue, JSON.stringify({ type: 'queue_changed' })).catch(() => undefined);
  }

  async list(limit = 100): Promise<QueueItem[]> {
    const rows = await this.redis.zrevrange(keys.queue, 0, limit - 1, 'WITHSCORES');
    const ids: string[] = [];
    const priorities: number[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      ids.push(rows[i]!);
      priorities.push(Number(rows[i + 1]));
    }
    if (ids.length === 0) return [];

    const [records, locks] = await Promise.all([this.sheets.readMany(ids), this.lockOwners(ids)]);
    return ids.map((sheetId, i) => {
      const rec = records.get(sheetId);
      return {
        sheetId,
        priority: priorities[i]!,
        table: rec?.table ?? 0,
        station: rec?.station ?? 0,
        municipality: rec?.municipality ?? 0,
        version: rec?.version ?? 0,
        voters: rec?.voters ?? 0,
        votes: rec?.votes ?? EMPTY_VOTES,
        lockedBy: locks[i] ?? null,
      };
    });
  }

  private async lockOwners(ids: string[]): Promise<(string | null)[]> {
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.get(keys.lock(id));
    const res = (await pipe.exec()) ?? [];
    return ids.map((_, i) => ownerOf((res[i]?.[1] ?? null) as string | null));
  }
}
