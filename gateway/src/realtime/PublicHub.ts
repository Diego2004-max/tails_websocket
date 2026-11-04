import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { parseTopic, type Topic } from '../../../shared/domain';
import type { DeltaMessage, Snapshot } from '../../../shared/protocol';
import { config } from '../config';
import type { Metrics } from '../metrics/Metrics';
import { Backplane } from './Backplane';
import { fanOutInBatches } from './fanOut';
import { TopicRegistry } from './TopicRegistry';
import { addDelta, type SheetEvent } from '../services/delta';
import type { HistoryService } from '../services/HistoryService';
import type { SnapshotService } from '../services/SnapshotService';

class PublicConnection {
  ready = false;
  needsSnapshot = false;
  closed = false;
  constructor(readonly res: ServerResponse, readonly topic: Topic) {}

  pendingBytes(): number {
    return this.res.writableLength;
  }
  write(chunk: string): void {
    if (!this.closed) this.res.write(chunk);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}

const frame = (event: string, data: unknown, id?: string): string =>
  `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n` +
  (config.ssePadBytes > 0 ? `: ${'x'.repeat(config.ssePadBytes)}\n\n` : '');

/**
 * Public audience: Server-Sent Events. One direction, plain HTTP, and the browser already
 * implements "resume from Last-Event-ID". We write the id of every frame so continuity is free.
 */
export class PublicHub {
  private readonly registry = new TopicRegistry<PublicConnection>();
  private pending = new Map<string, DeltaMessage>();
  private pendingSince = new Map<string, number>();
  private pendingCount = new Map<string, number>();
  private readonly resyncing = new Set<PublicConnection>();
  private newThisSecond = 0;
  private degraded = false;
  private flushing = false;

  constructor(
    private readonly backplane: Backplane,
    private readonly snapshots: SnapshotService,
    private readonly history: HistoryService,
    private readonly metrics: Metrics,
  ) {
    backplane.onTopic((topic, ev) => this.collect(topic, ev));
    setInterval(() => (this.newThisSecond = 0), 1000).unref();
    setInterval(() => void this.flush(), config.flushIntervalMs).unref();
    setInterval(() => void this.heartbeat(), 20_000).unref();
  }

  /* ---------- admission + connection lifecycle ---------- */

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parsed = parseTopic(url.searchParams.get('topic'));
    if (!parsed) return this.reject(res, 400, 'invalid topic');

    // Admission control: refuse politely (with a jittered Retry-After) instead of collapsing.
    if (++this.newThisSecond > config.admission.maxNewConnectionsPerSec) {
      return this.reject(res, 503, 'busy', String(1 + Math.floor(Math.random() * 10)));
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': config.allowedOrigin,
      'X-Instance-Id': config.instanceId,
    });
    res.write(`retry: 3000\n\n`);

    const conn = new PublicConnection(res, parsed.topic);
    this.metrics.connections.public++;
    if (this.registry.add(parsed.topic, conn)) this.backplane.retain(parsed.topic);
    req.on('close', () => this.drop(conn));

    const lastId = (req.headers['last-event-id'] as string | undefined) ?? url.searchParams.get('lastId') ?? undefined;
    try {
      await this.syncNewcomer(conn, lastId);
    } catch {
      conn.write(frame('status', { degraded: true }));
      conn.ready = true;
      conn.needsSnapshot = true;
      this.resyncing.add(conn);
    }
  }

  /** New or returning client: replay what it missed, or a full snapshot when replay is unsafe. */
  private async syncNewcomer(conn: PublicConnection, lastId?: string): Promise<void> {
    const result = lastId ? await this.history.replay(conn.topic, lastId) : { mode: 'snapshot' as const, reason: 'invalid-id' as const };
    if (result.mode === 'replay') {
      const payload = result.message ?? { topic: conn.topic, id: result.lastId, delta: {}, corrections: 0 };
      conn.write(frame('sync', { ...payload, id: result.message ? payload.id : lastId! }, result.message ? payload.id : lastId));
    } else {
      const snap = await this.snapshots.read(conn.topic);
      conn.write(frame('snapshot', snap, snap.id));
    }
    conn.ready = true;
    // Events that arrived while syncing may have been skipped: force one confirming snapshot.
    if (conn.needsSnapshot) this.resyncing.add(conn);
  }

  private drop(conn: PublicConnection): void {
    if (conn.closed && !this.registry.get(conn.topic)?.has(conn)) return;
    conn.closed = true;
    this.resyncing.delete(conn);
    this.metrics.connections.public--;
    if (this.registry.remove(conn.topic, conn)) this.backplane.release(conn.topic);
  }

  private reject(res: ServerResponse, status: number, message: string, retryAfter?: string): void {
    res.writeHead(status, {
      'Access-Control-Allow-Origin': config.allowedOrigin,
      ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
    });
    res.end(message);
  }

  /* ---------- coalescing: many sheets -> one message per topic per window ---------- */

  private collect(topic: string, ev: SheetEvent): void {
    const subscribers = this.registry.get(topic)?.size ?? 0;
    if (subscribers === 0) return;
    this.metrics.naive += subscribers; // a naive design sends every event to every subscriber
    this.pending.set(topic, addDelta(this.pending.get(topic) ?? null, topic as Topic, ev));
    this.pendingSince.set(topic, Math.min(this.pendingSince.get(topic) ?? Infinity, ev.at));
    this.pendingCount.set(topic, (this.pendingCount.get(topic) ?? 0) + 1);
  }

  /* ---------- fan-out in batches with back-pressure ---------- */

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const batch = this.pending;
      const since = this.pendingSince;
      this.pending = new Map();
      this.pendingSince = new Map();
      this.pendingCount = new Map();

      const snapshotCache = new Map<string, Promise<{ id: string; text: string } | null>>();
      const snapshotFor = (topic: Topic) => {
        let p = snapshotCache.get(topic);
        if (!p) {
          p = this.snapshots.read(topic).then((s: Snapshot) => ({ id: s.id, text: frame('snapshot', s, s.id) })).catch(() => null);
          snapshotCache.set(topic, p);
        }
        return p;
      };

      for (const [topic, message] of batch) {
        const conns = this.registry.get(topic);
        if (!conns?.size) continue;
        const text = frame('delta', message, message.id);
        await fanOutInBatches(conns, config.fanOutBatchSize, (conn) => this.deliver(conn, text));
        this.metrics.recordPublishLatency(Date.now() - (since.get(topic) ?? Date.now()));
      }

      // Slow clients that fell behind get ONE snapshot once they drain, not the missed detail.
      const lagging = [...this.resyncing];
      await fanOutInBatches(lagging, config.fanOutBatchSize, (conn) => {
        if (conn.closed) return void this.resyncing.delete(conn);
        if (conn.pendingBytes() > config.slowClient.lowWaterBytes) return;
        this.resyncing.delete(conn);
        conn.needsSnapshot = false;
        void snapshotFor(conn.topic).then((s) => {
          if (s) {
            conn.write(s.text);
            this.metrics.emitted++;
          } else {
            conn.needsSnapshot = true;
            this.resyncing.add(conn);
          }
        });
      });
    } finally {
      this.flushing = false;
    }
  }

  private deliver(conn: PublicConnection, text: string): void {
    if (conn.closed) return;
    if (!conn.ready) {
      conn.needsSnapshot = true;
      return;
    }
    const pending = conn.pendingBytes();
    const { highWaterBytes, hardLimitBytes } = config.slowClient;
    if (conn.needsSnapshot || pending > highWaterBytes) {
      if (!conn.needsSnapshot) {
        conn.needsSnapshot = true;
        this.resyncing.add(conn);
        this.metrics.slowDegraded++;
      }
      if (pending > hardLimitBytes) {
        // The client cannot keep up at all: cut it. EventSource reconnects with Last-Event-ID.
        this.metrics.slowDisconnected++;
        this.drop(conn);
        conn.res.destroy();
      }
      return;
    }
    conn.write(text);
    this.metrics.emitted++;
  }

  private async heartbeat(): Promise<void> {
    for (const set of this.registry.all()) {
      await fanOutInBatches(set, config.fanOutBatchSize, (c) => c.write(`: ping\n\n`));
    }
  }

  /* ---------- degraded mode + graceful shutdown ---------- */

  async setDegraded(value: boolean): Promise<void> {
    if (this.degraded === value) return;
    this.degraded = value;
    const text = frame('status', { degraded: value });
    for (const set of this.registry.all()) {
      await fanOutInBatches(set, config.fanOutBatchSize, (c) => c.write(text));
    }
  }

  /** Tell clients to come back at a random moment, then close. Avoids a synchronized stampede. */
  async shutdown(): Promise<void> {
    for (const set of this.registry.all()) {
      await fanOutInBatches([...set], config.fanOutBatchSize, (c) => {
        c.write(frame('reconnect', { afterMs: Math.floor(Math.random() * 10_000) }));
        c.close();
      });
    }
  }
}

export const newConnectionId = (): string => randomBytes(4).toString('hex');
