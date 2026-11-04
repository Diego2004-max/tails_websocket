import type { Topic, Votes } from './domain';

/* ---------- Jury / auditor (WebSocket, bidirectional) ---------- */

export interface SheetSubmission {
  sheetId: string;
  table: number;
  version: number;
  jurorId: string;
  closedAt: number;
  votes: Votes;
  voters: number;
  photoHash: string;
  idempotencyKey: string;
}

export type AckStatus = 'ACCEPTED' | 'FLAGGED' | 'DUPLICATE' | 'STALE';

export type JuryServerMessage =
  | { type: 'ack'; idempotencyKey: string; status: AckStatus; version: number }
  | { type: 'nack'; idempotencyKey: string; code: 'UNAVAILABLE' | 'RATE_LIMITED'; retryAfterMs: number }
  | { type: 'reject'; idempotencyKey: string; reason: string };

export type JuryClientMessage = { type: 'submit'; sheet: SheetSubmission };

export interface QueueItem {
  sheetId: string;
  priority: number;
  table: number;
  station: number;
  municipality: number;
  version: number;
  voters: number;
  votes: Votes;
  lockedBy: string | null;
}
export interface PresenceEntry {
  auditorId: string;
  instanceId: string;
  since: number;
  workingOn: string | null;
  workingSince: number | null;
}

export type AuditClientMessage =
  | { type: 'take'; sheetId: string }
  | { type: 'renew'; sheetId: string; token: string }
  | { type: 'release'; sheetId: string; token: string }
  | { type: 'resolve'; sheetId: string; token: string; votes: Votes; voters: number };

export type AuditServerMessage =
  | { type: 'state'; queue: QueueItem[]; presence: PresenceEntry[]; serverTime: number }
  | { type: 'taken'; sheetId: string; token: string }
  | { type: 'take_denied'; sheetId: string; reason: 'LOCKED' | 'NOT_IN_QUEUE'; by?: string }
  | { type: 'lock_lost'; sheetId: string }
  | { type: 'resolved'; sheetId: string }
  | { type: 'error'; code: 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID'; message: string };

/* ---------- Public results (Server-Sent Events, one direction) ---------- */

export interface Snapshot {
  topic: Topic;
  id: string; // stream id this snapshot is consistent with
  totals: Record<string, number>; // C1..UNMARKED + voters + tables
  tablesTotal: number;
  ranking: { candidate: string; votes: number }[];
}
export interface DeltaMessage {
  topic: Topic;
  id: string; // last stream id folded into this delta
  delta: Record<string, number>;
  corrections: number;
}
export interface SyncMessage extends DeltaMessage {
  mode: 'replay';
}
