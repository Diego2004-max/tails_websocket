import type { Topic } from '../../../../shared/domain';
import { compareStreamIds } from '../../../../shared/domain';
import type { DeltaMessage } from '../../../../shared/protocol';
import type { SheetEvent } from '../../platform/bus/events';

export type { SheetEvent };

/** Adds one event into an accumulated delta. Pure; used by live coalescing and by replay. */
export function addDelta(acc: DeltaMessage | null, topic: Topic, ev: SheetEvent): DeltaMessage {
  const base: DeltaMessage = acc ?? { topic, id: ev.id, delta: {}, corrections: 0 };
  for (const [k, v] of Object.entries(ev.delta)) base.delta[k] = (base.delta[k] ?? 0) + v;
  if (ev.correction) base.corrections += 1;
  if (compareStreamIds(ev.id, base.id) > 0) base.id = ev.id;
  return base;
}
