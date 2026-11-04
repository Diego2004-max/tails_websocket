const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Runs `action` for every item but gives the Event Loop back every `batchSize` items.
 * A 50,000-connection loop without yielding would freeze the whole process (jurors included).
 * setImmediate lets pending I/O (acks, pings, new requests) run between batches.
 */
export async function fanOutInBatches<T>(
  items: Iterable<T>,
  batchSize: number,
  action: (item: T) => void,
): Promise<void> {
  let n = 0;
  for (const item of items) {
    action(item);
    if (++n % batchSize === 0) await yieldToEventLoop();
  }
}
