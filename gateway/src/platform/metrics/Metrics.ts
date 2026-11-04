import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from '../config';
import type { ScriptedRedis } from '../redis/client';
import { isRedisReady } from '../redis/client';
import { keys } from '../redis/keys';

/** What the audience modules are allowed to record. They never read cluster state. */
export interface RuntimeMetrics {
  connections: { public: number; jury: number; audit: number };
  emitted: number;
  naive: number;
  slowDegraded: number;
  slowDisconnected: number;
  recordSheet(): void;
  recordPublishLatency(ms: number): void;
}

export interface InstanceMetrics {
  instanceId: string;
  at: number;
  uptimeSec: number;
  connections: { public: number; jury: number; audit: number };
  messages: { emitted: number; naive: number; perSec: number };
  eventLoop: { p50: number; p99: number; max: number };
  memory: { rssMb: number; kbPerConnection: number };
  sheetsPerMinute: number;
  publishLatencyMs: { p50: number; p99: number };
  slowClients: { degraded: number; disconnected: number };
  redis: 'ready' | 'down';
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

/** Plain counters + a periodic publication to Redis so ANY instance can serve cluster-wide metrics. */
export class Metrics {
  readonly connections = { public: 0, jury: 0, audit: 0 };
  emitted = 0;
  /** What a naive "one message per sheet per client" design would have sent. */
  naive = 0;
  slowDegraded = 0;
  slowDisconnected = 0;

  private readonly loop = monitorEventLoopDelay({ resolution: 10 });
  private readonly startedAt = Date.now();
  private sheetBuckets = new Map<number, number>();
  private latencies: number[] = [];
  private lastEmitted = 0;
  private lastTick = Date.now();
  private perSec = 0;
  private timer?: NodeJS.Timeout;

  constructor(private readonly redis: ScriptedRedis) {
    this.loop.enable();
  }

  recordSheet(): void {
    const minute = Math.floor(Date.now() / 60_000);
    this.sheetBuckets.set(minute, (this.sheetBuckets.get(minute) ?? 0) + 1);
    for (const k of this.sheetBuckets.keys()) if (k < minute - 5) this.sheetBuckets.delete(k);
  }
  recordPublishLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 2000) this.latencies.shift();
  }

  snapshot(): InstanceMetrics {
    const total = this.connections.public + this.connections.jury + this.connections.audit;
    const rss = process.memoryUsage().rss;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const minute = Math.floor(Date.now() / 60_000);
    return {
      instanceId: config.instanceId,
      at: Date.now(),
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      connections: { ...this.connections },
      messages: { emitted: this.emitted, naive: this.naive, perSec: this.perSec },
      eventLoop: { p50: ns2ms(this.loop.percentile(50)), p99: ns2ms(this.loop.percentile(99)), max: ns2ms(this.loop.max) },
      memory: { rssMb: Math.round(rss / 1e6), kbPerConnection: total ? Math.round(rss / 1024 / total) : 0 },
      sheetsPerMinute: this.sheetBuckets.get(minute - 1) ?? this.sheetBuckets.get(minute) ?? 0,
      publishLatencyMs: { p50: pct(sorted, 0.5), p99: pct(sorted, 0.99) },
      slowClients: { degraded: this.slowDegraded, disconnected: this.slowDisconnected },
      redis: isRedisReady(this.redis) ? 'ready' : 'down',
    };
  }

  /** Publishes this instance's metrics to Redis every 2 s (TTL 10 s => dead instances disappear). */
  start(): void {
    this.timer = setInterval(() => {
      const now = Date.now();
      this.perSec = Math.round(((this.emitted - this.lastEmitted) * 1000) / (now - this.lastTick));
      this.lastEmitted = this.emitted;
      this.lastTick = now;
      const snap = this.snapshot();
      this.loop.reset(); // report the event-loop delay of the last window, not of all time
      this.redis.set(keys.metrics(config.instanceId), JSON.stringify(snap), 'EX', 10).catch(() => undefined);
    }, 2000);
    this.timer.unref();
  }

  async cluster(): Promise<InstanceMetrics[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', keys.metricsPattern, 'COUNT', 100);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    if (found.length === 0) return [];
    const raws = await this.redis.mget(found);
    return raws
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as InstanceMetrics)
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }
}

const ns2ms = (ns: number) => Math.round((ns / 1e6) * 100) / 100;
