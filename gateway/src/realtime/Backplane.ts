import type Redis from 'ioredis';
import { keys } from '../redis/keys';
import type { SheetEvent } from '../services/delta';

type TopicHandler = (topic: string, event: SheetEvent) => void;
type QueueHandler = () => void;

/**
 * Redis Pub/Sub as the live backplane. Channel-per-topic (dept, mun:N, pst:N):
 * an instance subscribes ONLY to topics that have local subscribers (ref-counted),
 * so inter-instance traffic is proportional to real interest, not to total volume.
 * Pub/Sub has no memory: recovery comes from the Redis Stream (HistoryService).
 */
export class Backplane {
  private topicHandler: TopicHandler = () => undefined;
  private queueHandler: QueueHandler = () => undefined;
  private readonly refs = new Map<string, number>();

  constructor(private readonly sub: Redis) {
    sub.on('message', (channel, message) => {
      if (channel === keys.channel.queue) return this.queueHandler();
      if (!channel.startsWith(keys.channel.prefix)) return;
      const topic = channel.slice(keys.channel.prefix.length);
      try {
        this.topicHandler(topic, JSON.parse(message) as SheetEvent);
      } catch (err) {
        console.error('[backplane] bad message', (err as Error).message);
      }
    });
  }

  onTopic(handler: TopicHandler): void {
    this.topicHandler = handler;
  }
  onQueue(handler: QueueHandler): void {
    this.queueHandler = handler;
  }

  async subscribeQueue(): Promise<void> {
    await this.sub.subscribe(keys.channel.queue);
  }

  retain(topic: string): void {
    const n = (this.refs.get(topic) ?? 0) + 1;
    this.refs.set(topic, n);
    if (n === 1) this.sub.subscribe(keys.channel.topic(topic)).catch(() => undefined);
  }

  release(topic: string): void {
    const n = (this.refs.get(topic) ?? 0) - 1;
    if (n <= 0) {
      this.refs.delete(topic);
      this.sub.unsubscribe(keys.channel.topic(topic)).catch(() => undefined);
    } else this.refs.set(topic, n);
  }
}
