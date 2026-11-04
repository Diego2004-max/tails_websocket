import { WebSocket } from 'ws';
import { balances, VOTE_KEYS, type Votes } from '../../../shared/domain';
import type { AuditClientMessage, AuditServerMessage, PresenceEntry, QueueItem } from '../../../shared/protocol';
import { config } from '../config';
import type { Metrics } from '../metrics/Metrics';
import type { ScriptedRedis } from '../redis/client';
import { keys } from '../redis/keys';
import { LockService, ownerOf } from '../services/LockService';
import type { PresenceService } from '../services/PresenceService';
import type { RateLimiter } from '../services/RateLimiter';
import type { SheetService } from '../services/SheetService';
import { randomUUID } from 'node:crypto';

interface AuditSession {
  ws: WebSocket;
  auditorId: string;
  since: number;
  workingOn: string | null;
  workingSince: number | null;
  tokens: Map<string, string>; // sheetId -> lock token held by this socket
  alive: boolean;
}

/**
 * Auditors: WebSocket. Collaborative and bidirectional (they see each other's actions live).
 * State of truth is Redis (queue ZSET + lock keys + presence keys). Each instance only fans the
 * resulting state out to ITS OWN sockets; coordination between instances is Pub/Sub only.
 */
export class AuditHub {
  private readonly sessions = new Set<AuditSession>();
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: ScriptedRedis,
    private readonly locks: LockService,
    private readonly presence: PresenceService,
    private readonly sheets: SheetService,
    private readonly limiter: RateLimiter,
    private readonly metrics: Metrics,
  ) {
    // Locks that expire silently have no event, so reconcile periodically as well.
    setInterval(() => this.scheduleBroadcast(), 3000).unref();
    setInterval(() => this.pingAll(), 15_000).unref();
  }

  /** Called by the Backplane when ANY instance changed the queue or a lock. */
  scheduleBroadcast(): void {
    if (this.broadcastTimer || this.sessions.size === 0) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      void this.broadcast();
    }, 150);
  }

  attach(ws: WebSocket, url: URL): void {
    const auditorId = (url.searchParams.get('auditor') ?? '').slice(0, 32);
    if (auditorId.length < 3) return void ws.close(4400, 'auditor required');

    const session: AuditSession = { ws, auditorId, since: Date.now(), workingOn: null, workingSince: null, tokens: new Map(), alive: true };
    this.sessions.add(session);
    this.metrics.connections.audit++;
    void this.beat(session);
    const beat = setInterval(() => void this.beat(session), config.presenceHeartbeatMs);

    ws.on('pong', () => (session.alive = true));
    ws.on('error', () => undefined);
    ws.on('close', () => {
      clearInterval(beat);
      this.sessions.delete(session);
      this.metrics.connections.audit--;
      void this.cleanup(session);
    });
    ws.on('message', (raw) => void this.onMessage(session, raw.toString()));
    this.scheduleBroadcast();
  }

  private async onMessage(s: AuditSession, raw: string): Promise<void> {
    try {
      const rate = await this.limiter.hit(`aud:${s.auditorId}`);
      if (!rate.allowed) return this.send(s.ws, { type: 'error', code: 'RATE_LIMITED', message: 'Demasiadas acciones seguidas.' });
      const msg = JSON.parse(raw) as AuditClientMessage;

      if (msg.type === 'take') return await this.take(s, msg.sheetId);
      if (msg.type === 'renew') {
        const ok = await this.locks.renew(msg.sheetId, msg.token);
        if (!ok) {
          s.tokens.delete(msg.sheetId);
          this.send(s.ws, { type: 'lock_lost', sheetId: msg.sheetId });
        }
        return;
      }
      if (msg.type === 'release') return await this.release(s, msg.sheetId, msg.token);
      if (msg.type === 'resolve') return await this.resolve(s, msg);
    } catch {
      this.send(s.ws, { type: 'error', code: 'UNAVAILABLE', message: 'Sin conexión con Redis. Reintenta.' });
    }
  }

  private async take(s: AuditSession, sheetId: string): Promise<void> {
    if ((await this.redis.zscore(keys.queue, sheetId)) === null) {
      return this.send(s.ws, { type: 'take_denied', sheetId, reason: 'NOT_IN_QUEUE' });
    }
    const result = await this.locks.acquire(sheetId, s.auditorId);
    if (!result.ok) return this.send(s.ws, { type: 'take_denied', sheetId, reason: 'LOCKED', by: result.heldBy ?? undefined });
    s.tokens.set(sheetId, result.token);
    s.workingOn = sheetId;
    s.workingSince = Date.now();
    this.send(s.ws, { type: 'taken', sheetId, token: result.token });
    await this.beat(s);
    await this.notifyQueueChanged();
  }

  private async release(s: AuditSession, sheetId: string, token: string): Promise<void> {
    await this.locks.release(sheetId, token); // no-op if the lock is no longer ours
    s.tokens.delete(sheetId);
    if (s.workingOn === sheetId) (s.workingOn = null), (s.workingSince = null);
    await this.beat(s);
    await this.notifyQueueChanged();
  }

  private async resolve(s: AuditSession, msg: Extract<AuditClientMessage, { type: 'resolve' }>): Promise<void> {
    // Fencing: a late auditor whose lock expired (and was reassigned) cannot write.
    if (!(await this.locks.isOwner(msg.sheetId, msg.token))) {
      s.tokens.delete(msg.sheetId);
      return this.send(s.ws, { type: 'lock_lost', sheetId: msg.sheetId });
    }
    const votes = Object.fromEntries(VOTE_KEYS.map((k) => [k, Math.max(0, Math.floor(Number(msg.votes?.[k] ?? 0)))])) as Votes;
    if (!balances(votes, msg.voters)) {
      return this.send(s.ws, { type: 'error', code: 'INVALID', message: 'Los totales no cuadran con los sufragantes.' });
    }
    const record = await this.redis.hgetall(keys.sheet(msg.sheetId));
    const table = Number(record.table);
    if (!table) return this.send(s.ws, { type: 'error', code: 'INVALID', message: 'Acta desconocida.' });

    const nextVersion = (await this.sheets.currentVersion(msg.sheetId)) + 1;
    await this.sheets.ingest({
      sheetId: msg.sheetId, table, version: nextVersion, jurorId: s.auditorId, closedAt: Math.floor(Date.now() / 1000),
      votes, voters: msg.voters, photoHash: 'verified', idempotencyKey: `verify-${msg.sheetId}-${nextVersion}-${randomUUID().slice(0, 8)}`,
    });
    await this.release(s, msg.sheetId, msg.token);
    this.send(s.ws, { type: 'resolved', sheetId: msg.sheetId });
  }

  /** Socket closed (browser closed, network lost): free its locks right away, drop presence. */
  private async cleanup(s: AuditSession): Promise<void> {
    try {
      for (const [sheetId, token] of s.tokens) await this.locks.release(sheetId, token);
      const stillConnectedElsewhere = [...this.sessions].some((o) => o.auditorId === s.auditorId);
      if (!stillConnectedElsewhere) await this.presence.remove(s.auditorId);
      await this.notifyQueueChanged();
    } catch {
      /* TTLs (lock 30 s, presence 20 s) clean up anyway: that is the safety net */
    }
  }

  private async beat(s: AuditSession): Promise<void> {
    const entry: PresenceEntry = { auditorId: s.auditorId, instanceId: config.instanceId, since: s.since, workingOn: s.workingOn, workingSince: s.workingSince };
    await this.presence.beat(entry).catch(() => undefined);
  }

  private notifyQueueChanged(): Promise<unknown> {
    return this.redis.publish(keys.channel.queue, JSON.stringify({ type: 'queue_changed' })).catch(() => undefined);
  }

  private async broadcast(): Promise<void> {
    if (this.sessions.size === 0) return;
    try {
      const [queue, presence] = await Promise.all([this.readQueue(), this.presence.list()]);
      const text = JSON.stringify({ type: 'state', queue, presence, serverTime: Date.now() } satisfies AuditServerMessage);
      for (const s of this.sessions) if (s.ws.readyState === WebSocket.OPEN) s.ws.send(text);
    } catch {
      /* Redis down: auditors keep their last view; the UI shows the connection banner */
    }
  }

  private async readQueue(): Promise<QueueItem[]> {
    const rows = await this.redis.zrevrange(keys.queue, 0, 99, 'WITHSCORES');
    const ids: string[] = [];
    const priorities: number[] = [];
    for (let i = 0; i < rows.length; i += 2) (ids.push(rows[i]), priorities.push(Number(rows[i + 1])));
    if (ids.length === 0) return [];
    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.hgetall(keys.sheet(id)).get(keys.lock(id));
    const res = (await pipe.exec()) ?? [];
    return ids.map((sheetId, i) => {
      const rec = (res[i * 2]?.[1] ?? {}) as Record<string, string>;
      const lock = (res[i * 2 + 1]?.[1] ?? null) as string | null;
      return {
        sheetId, priority: priorities[i], table: Number(rec.table), station: Number(rec.station), municipality: Number(rec.municipality),
        version: Number(rec.version), voters: Number(rec.voters), votes: JSON.parse(rec.votes ?? '{}') as Votes, lockedBy: ownerOf(lock),
      };
    });
  }

  private pingAll(): void {
    for (const s of this.sessions) {
      if (!s.alive) { s.ws.terminate(); continue; } // dead peer (laptop lost power): detected here
      s.alive = false;
      s.ws.ping();
    }
  }

  private send(ws: WebSocket, msg: AuditServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
