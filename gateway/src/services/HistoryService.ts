import { compareStreamIds, isStreamId, type Topic } from '../../../shared/domain';
import type { DeltaMessage } from '../../../shared/protocol';
import { config } from '../config';
import type { ScriptedRedis } from '../redis/client';
import { keys } from '../redis/keys';
import { addDelta, type SheetEvent } from './delta';

export type ReplayResult =
  | { mode: 'replay'; message: DeltaMessage | null; lastId: string }
  | { mode: 'snapshot'; reason: 'invalid-id' | 'gap' | 'too-many' };

/**
 * Recovery (RF-6). History lives in a Redis Stream: monotonic ids, bounded by MAXLEN.
 * Pub/Sub alone has no memory, so it is used only for live notification.
 */
export class HistoryService {
  constructor(private readonly redis: ScriptedRedis) {}

  async replay(topic: Topic, lastId: string | undefined): Promise<ReplayResult> {
    if (!isStreamId(lastId)) return { mode: 'snapshot', reason: 'invalid-id' };

    const [first] = await this.redis.xrange(keys.events, '-', '+', 'COUNT', 1);
    // The client is older than the oldest retained entry: something was trimmed away.
    if (first && compareStreamIds(lastId, first[0]) < 0) return { mode: 'snapshot', reason: 'gap' };

    const entries = await this.redis.xrange(keys.events, `(${lastId}`, '+', 'COUNT', config.replayLimit + 1);
    if (entries.length > config.replayLimit) return { mode: 'snapshot', reason: 'too-many' };

    let merged: DeltaMessage | null = null;
    let tail = lastId;
    for (const [id, fields] of entries) {
      tail = id;
      const ev = JSON.parse(fields[1]) as SheetEvent;
      ev.id = id;
      if (!eventBelongsTo(topic, ev)) continue;
      merged = addDelta(merged, topic, ev);
    }
    return { mode: 'replay', message: merged, lastId: tail };
  }
}

function eventBelongsTo(topic: Topic, ev: SheetEvent): boolean {
  if (topic === 'dept') return true;
  const [level, id] = topic.split(':');
  return level === 'mun' ? ev.municipality === Number(id) : ev.station === Number(id);
}
