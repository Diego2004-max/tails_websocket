import { GEOGRAPHY, locate, VOTE_KEYS, type Votes } from '@shared/domain';
import type { AckStatus, PresenceEntry, SheetSubmission } from '@shared/protocol';

export interface StoredSheet {
  sheetId: string;
  table: number;
  station: number;
  municipality: number;
  version: number;
  votes: Votes;
  voters: number;
  counted: boolean;
  jurorId: string;
}

export interface IdemRecord {
  status: AckStatus;
  version: number;
  at: number;
}

export interface SheetEvent {
  id: string;
  sheetId: string;
  table: number;
  station: number;
  municipality: number;
  version: number;
  correction: boolean;
  delta: Record<string, number>;
  at: number;
}

export interface DemoMetrics {
  sheetsTotal: number;
  sheetsPerMinute: number;
  emitted: number;
  naive: number;
  publicPolls: number;
  juryPosts: number;
  auditPolls: number;
  lastSheetAt: number;
  minuteBucket: number;
  sheetsInMinute: number;
}

export interface DemoState {
  seeded: boolean;
  lastStreamId: string;
  streamSeq: number;
  sheets: Map<string, StoredSheet>;
  idem: Map<string, IdemRecord>;
  aggs: Map<string, Record<string, number>>;
  tablesTotal: Map<string, number>;
  queue: Map<string, number>;
  locks: Map<string, { token: string; auditorId: string; expiresAt: number }>;
  presence: Map<string, PresenceEntry & { expiresAt: number }>;
  events: SheetEvent[];
  metrics: DemoMetrics;
}

function emptyAgg(): Record<string, number> {
  return Object.fromEntries([...VOTE_KEYS, 'voters', 'tables'].map((k) => [k, 0]));
}

export function createDemoState(): DemoState {
  return {
    seeded: false,
    lastStreamId: '0-0',
    streamSeq: 0,
    sheets: new Map(),
    idem: new Map(),
    aggs: new Map(),
    tablesTotal: new Map(),
    queue: new Map(),
    locks: new Map(),
    presence: new Map(),
    events: [],
    metrics: {
      sheetsTotal: 0,
      sheetsPerMinute: 0,
      emitted: 0,
      naive: 0,
      publicPolls: 0,
      juryPosts: 0,
      auditPolls: 0,
      lastSheetAt: 0,
      minuteBucket: 0,
      sheetsInMinute: 0,
    },
  };
}

export function seedGeography(state: DemoState): void {
  if (state.seeded) return;
  state.tablesTotal.set('dept:1', GEOGRAPHY.tables);
  const perStation = new Map<number, number>();
  const perMunicipality = new Map<number, number>();
  for (let t = 1; t <= GEOGRAPHY.tables; t++) {
    const l = locate(t);
    perStation.set(l.station, (perStation.get(l.station) ?? 0) + 1);
    perMunicipality.set(l.municipality, (perMunicipality.get(l.municipality) ?? 0) + 1);
  }
  for (const [id, n] of perStation) state.tablesTotal.set(`pst:${id}`, n);
  for (const [id, n] of perMunicipality) state.tablesTotal.set(`mun:${id}`, n);
  for (const key of state.tablesTotal.keys()) {
    if (!state.aggs.has(key)) state.aggs.set(key, emptyAgg());
  }
  state.seeded = true;
}

const g = globalThis as unknown as { __ballotDemoState?: DemoState };

export function getDemoState(): DemoState {
  if (!g.__ballotDemoState) g.__ballotDemoState = createDemoState();
  seedGeography(g.__ballotDemoState);
  return g.__ballotDemoState;
}

/** Swap the in-process cache after a Redis pull. */
export function replaceDemoState(next: DemoState): DemoState {
  seedGeography(next);
  g.__ballotDemoState = next;
  return next;
}

export function sheetDelta(record: StoredSheet, sign: 1 | -1): Record<string, number> {
  const delta: Record<string, number> = { tables: sign };
  for (const k of VOTE_KEYS) delta[k] = sign * record.votes[k];
  delta.voters = sign * record.voters;
  return delta;
}

export function bumpSheetMetric(state: DemoState): void {
  const minute = Math.floor(Date.now() / 60_000);
  if (state.metrics.minuteBucket !== minute) {
    state.metrics.sheetsPerMinute = state.metrics.sheetsInMinute;
    state.metrics.minuteBucket = minute;
    state.metrics.sheetsInMinute = 0;
  }
  state.metrics.sheetsInMinute++;
  state.metrics.sheetsTotal++;
  state.metrics.lastSheetAt = Date.now();
}

export function nextEventId(state: DemoState): string {
  state.streamSeq++;
  const id = `${Date.now()}-${state.streamSeq}`;
  state.lastStreamId = id;
  return id;
}

export function touchSubmission(_: SheetSubmission): void {
  /* hook for future validation */
}
