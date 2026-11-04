import {
  balances,
  CANDIDATES,
  compareStreamIds,
  isStreamId,
  locate,
  parseTopic,
  sumVotes,
  topicsOf,
  type Topic,
  VOTE_KEYS,
  type Votes,
} from '@shared/domain';
import type { AckStatus, DeltaMessage, PresenceEntry, QueueItem, SheetSubmission, Snapshot } from '@shared/protocol';
import { addDelta } from './delta';
import { storeBackend } from './sync';
import {
  bumpSheetMetric,
  getDemoState,
  nextEventId,
  seedGeography,
  sheetDelta,
  type DemoState,
  type SheetEvent,
  type StoredSheet,
} from './state';

const IDEM_TTL_MS = 86_400_000;
const LOCK_TTL_MS = 30_000;
const PRESENCE_TTL_MS = 20_000;
const MAX_EVENTS = 5000;

export interface IngestResult {
  status: AckStatus;
  version: number;
}

function aggKey(level: 'tbl' | 'pst' | 'mun' | 'dept', id: number): string {
  return `${level === 'dept' ? 'dept' : level}:${id}`;
}

function applyAgg(state: DemoState, level: 'tbl' | 'pst' | 'mun' | 'dept', id: number, delta: Record<string, number>): void {
  const key = aggKey(level, id);
  const cur = state.aggs.get(key) ?? Object.fromEntries([...VOTE_KEYS, 'voters', 'tables'].map((k) => [k, 0]));
  for (const [k, v] of Object.entries(delta)) cur[k] = (cur[k] ?? 0) + v;
  state.aggs.set(key, cur);
}

function applySheetToAggs(state: DemoState, record: StoredSheet, sign: 1 | -1): void {
  const d = sheetDelta(record, sign);
  applyAgg(state, 'tbl', record.table, d);
  applyAgg(state, 'pst', record.station, d);
  applyAgg(state, 'mun', record.municipality, d);
  applyAgg(state, 'dept', 1, d);
}

function pruneIdem(state: DemoState): void {
  const cutoff = Date.now() - IDEM_TTL_MS;
  for (const [k, v] of state.idem) if (v.at < cutoff) state.idem.delete(k);
}

function appendEvent(state: DemoState, record: StoredSheet, correction: boolean): void {
  const id = nextEventId(state);
  const ev: SheetEvent = {
    id,
    sheetId: record.sheetId,
    table: record.table,
    station: record.station,
    municipality: record.municipality,
    version: record.version,
    correction,
    delta: sheetDelta(record, 1),
    at: Date.now(),
  };
  state.events.push(ev);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  state.metrics.emitted += topicsOf(record.station, record.municipality).length;
  state.metrics.naive += topicsOf(record.station, record.municipality).length * 8;
}

function eventForTopic(topic: Topic, ev: SheetEvent): boolean {
  if (topic === 'dept') return true;
  const [level, id] = topic.split(':');
  return level === 'mun' ? ev.municipality === Number(id) : ev.station === Number(id);
}

export function ingest(submission: SheetSubmission): IngestResult {
  const state = getDemoState();
  seedGeography(state);
  pruneIdem(state);

  const existing = state.idem.get(submission.idempotencyKey);
  if (existing) return { status: 'DUPLICATE', version: existing.version };

  const stored = state.sheets.get(submission.sheetId);
  const storedVersion = stored?.version ?? 0;
  if (submission.version <= storedVersion) {
    const res = { status: 'STALE' as const, version: storedVersion };
    state.idem.set(submission.idempotencyKey, { ...res, at: Date.now() });
    return res;
  }

  const { table, station, municipality } = locate(submission.table);
  const flagged = !balances(submission.votes, submission.voters);
  const priority = Math.abs(sumVotes(submission.votes) - submission.voters);

  if (stored?.counted) applySheetToAggs(state, stored, -1);

  const record: StoredSheet = {
    sheetId: submission.sheetId,
    table,
    station,
    municipality,
    version: submission.version,
    votes: submission.votes,
    voters: submission.voters,
    counted: !flagged,
    jurorId: submission.jurorId,
  };
  state.sheets.set(submission.sheetId, record);

  if (!flagged) {
    applySheetToAggs(state, record, 1);
    state.queue.delete(submission.sheetId);
  } else {
    state.queue.set(submission.sheetId, priority);
  }

  appendEvent(state, record, storedVersion > 0);
  bumpSheetMetric(state);

  const ackStatus: AckStatus = flagged ? 'FLAGGED' : 'ACCEPTED';
  const res = { status: ackStatus, version: submission.version };
  state.idem.set(submission.idempotencyKey, { ...res, at: Date.now() });
  return res;
}

export function readSnapshot(topic: Topic): Snapshot {
  const state = getDemoState();
  seedGeography(state);
  const parsed = parseTopic(topic);
  if (!parsed) throw new Error('invalid topic');
  const levelKey = parsed.level === 'dept' ? 'dept:1' : `${parsed.level}:${parsed.id}`;
  const hash = state.aggs.get(levelKey) ?? {};
  const totals: Record<string, number> = {};
  for (const k of [...VOTE_KEYS, 'voters', 'tables']) totals[k] = hash[k] ?? 0;
  return {
    topic,
    id: state.lastStreamId,
    totals,
    tablesTotal: state.tablesTotal.get(levelKey) ?? 0,
    ranking: CANDIDATES.map((c) => ({ candidate: c, votes: totals[c] ?? 0 })).sort((a, b) => b.votes - a.votes),
  };
}

export function pollTopic(topic: Topic, since?: string): { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'delta'; message: DeltaMessage | null; lastId: string } {
  const state = getDemoState();
  state.metrics.publicPolls++;
  if (!since || !isStreamId(since)) {
    return { kind: 'snapshot', snapshot: readSnapshot(topic) };
  }
  let merged: DeltaMessage | null = null;
  let tail = since;
  for (const ev of state.events) {
    if (compareStreamIds(ev.id, since) <= 0) continue;
    if (!eventForTopic(topic, ev)) continue;
    tail = ev.id;
    merged = addDelta(merged, topic, ev);
  }
  if (!merged) return { kind: 'delta', message: null, lastId: tail };
  return { kind: 'delta', message: merged, lastId: merged.id };
}

export function auditState(auditorId?: string): { queue: QueueItem[]; presence: PresenceEntry[]; serverTime: number } {
  const state = getDemoState();
  state.metrics.auditPolls++;
  const now = Date.now();
  if (auditorId && auditorId.length >= 3) touchPresence(state, auditorId, now);

  for (const [sheetId, lock] of state.locks) {
    if (lock.expiresAt <= now) state.locks.delete(sheetId);
  }
  for (const [id, p] of state.presence) {
    if (p.expiresAt <= now) state.presence.delete(id);
  }

  const ids = [...state.queue.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 100);
  const queue: QueueItem[] = ids.map((sheetId) => {
    const rec = state.sheets.get(sheetId);
    const lock = state.locks.get(sheetId);
    return {
      sheetId,
      priority: state.queue.get(sheetId) ?? 0,
      table: rec?.table ?? 0,
      station: rec?.station ?? 0,
      municipality: rec?.municipality ?? 0,
      version: rec?.version ?? 0,
      voters: rec?.voters ?? 0,
      votes: rec?.votes ?? (Object.fromEntries(VOTE_KEYS.map((k) => [k, 0])) as Votes),
      lockedBy: lock ? lock.auditorId : null,
    };
  });

  const presence = [...state.presence.values()].map(({ expiresAt: _, ...p }) => p);
  return { queue, presence, serverTime: now };
}

function touchPresence(state: DemoState, auditorId: string, now: number, workingOn: string | null = null, workingSince: number | null = null): void {
  const prev = state.presence.get(auditorId);
  state.presence.set(auditorId, {
    auditorId,
    instanceId: 'vercel-demo',
    since: prev?.since ?? now,
    workingOn: workingOn ?? prev?.workingOn ?? null,
    workingSince: workingOn ? now : prev?.workingSince ?? null,
    expiresAt: now + PRESENCE_TTL_MS,
  });
}

export type AuditAction =
  | { type: 'take'; sheetId: string; auditorId: string }
  | { type: 'renew'; sheetId: string; token: string }
  | { type: 'release'; sheetId: string; token: string }
  | { type: 'resolve'; sheetId: string; token: string; votes: Votes; voters: number; auditorId: string };

export function auditAction(action: AuditAction): { ok: true; data?: unknown } | { ok: false; code: string; message?: string; by?: string } {
  const state = getDemoState();
  const now = Date.now();

  if (action.type === 'take') {
    if (!state.queue.has(action.sheetId)) return { ok: false, code: 'NOT_IN_QUEUE' };
    const held = state.locks.get(action.sheetId);
    if (held && held.expiresAt > now) return { ok: false, code: 'LOCKED', by: held.auditorId };
    const token = `${action.auditorId}:${crypto.randomUUID()}`;
    state.locks.set(action.sheetId, { token, auditorId: action.auditorId, expiresAt: now + LOCK_TTL_MS });
    touchPresence(state, action.auditorId, now, action.sheetId, now);
    return { ok: true, data: { sheetId: action.sheetId, token } };
  }

  if (action.type === 'renew') {
    for (const [, lock] of state.locks) {
      if (lock.token === action.token && lock.expiresAt > now) {
        lock.expiresAt = now + LOCK_TTL_MS;
        touchPresence(state, lock.auditorId, now, state.presence.get(lock.auditorId)?.workingOn ?? null, state.presence.get(lock.auditorId)?.workingSince ?? now);
        return { ok: true };
      }
    }
    return { ok: false, code: 'LOCK_LOST' };
  }

  if (action.type === 'release') {
    const lock = state.locks.get(action.sheetId);
    if (lock?.token === action.token) {
      state.locks.delete(action.sheetId);
      touchPresence(state, lock.auditorId, now, null, null);
    }
    return { ok: true };
  }

  if (action.type === 'resolve') {
    const lock = state.locks.get(action.sheetId);
    if (!lock || lock.token !== action.token) return { ok: false, code: 'LOCK_LOST' };
    if (!balances(action.votes, action.voters)) return { ok: false, code: 'INVALID', message: 'Los totales no cuadran.' };
    const rec = state.sheets.get(action.sheetId);
    if (!rec) return { ok: false, code: 'INVALID', message: 'Acta desconocida.' };
    ingest({
      sheetId: action.sheetId,
      table: rec.table,
      version: rec.version + 1,
      jurorId: action.auditorId,
      closedAt: Math.floor(now / 1000),
      votes: action.votes,
      voters: action.voters,
      photoHash: 'verified',
      idempotencyKey: `verify-${action.sheetId}-${rec.version + 1}-${crypto.randomUUID().slice(0, 8)}`,
    });
    state.locks.delete(action.sheetId);
    touchPresence(state, action.auditorId, now, null, null);
    return { ok: true, data: { sheetId: action.sheetId } };
  }

  return { ok: false, code: 'BAD_REQUEST' };
}

export function demoMetricsPayload() {
  const state = getDemoState();
  const naive = Math.max(state.metrics.naive, state.metrics.emitted * 12);
  return {
    mode: 'vercel-demo' as const,
    instances: [
      {
        instanceId: process.env.VERCEL_REGION ? `vercel-${process.env.VERCEL_REGION}` : 'vercel-demo-local',
        at: Date.now(),
        uptimeSec: Math.floor(typeof process.uptime === 'function' ? process.uptime() : 0),
        connections: { public: Math.min(50, state.metrics.publicPolls % 50), jury: 0, audit: state.presence.size },
        messages: { emitted: state.metrics.emitted, naive, perSec: state.metrics.emitted > 0 ? 2 : 0 },
        eventLoop: { p50: 1, p99: 4, max: 12 },
        memory: { rssMb: 128, kbPerConnection: 48 },
        sheetsPerMinute: state.metrics.sheetsPerMinute,
        publishLatencyMs: { p50: 80, p99: 220 },
        slowClients: { degraded: 0, disconnected: 0 },
        redis: storeBackend() === 'redis' ? 'ready' as const : 'down' as const,
      },
    ],
    note: storeBackend() === 'redis'
      ? 'Estado compartido en Redis (Upstash). Todas las visitas de este deploy ven el mismo preconteo.'
      : 'Sin Redis: el preconteo vive en esta instancia y se pierde al enfriarse. Define UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN.',
  };
}
