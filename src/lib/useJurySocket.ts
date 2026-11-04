'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sheetIdOf, type Votes } from '@shared/domain';
import type { AckStatus, JuryServerMessage, SheetSubmission } from '@shared/protocol';
import { ReconnectPolicy } from '@shared/reconnect';
import { demoApi, usesGateway, wsUrl } from './gateway';

export type OutboxState = 'queued' | 'sending' | 'confirmed' | 'flagged' | 'duplicate' | 'stale' | 'rejected';
export interface OutboxEntry {
  submission: SheetSubmission;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
}

const STORAGE_KEY = 'ballot.outbox.v1';
const TERMINAL: OutboxState[] = ['confirmed', 'flagged', 'duplicate', 'stale', 'rejected'];

const load = (): OutboxEntry[] => {
  try {
    const items = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as OutboxEntry[];
    return items.map((e) => (e.state === 'sending' ? { ...e, state: 'queued' as const } : e));
  } catch {
    return [];
  }
};

const STATE_FROM_ACK: Record<AckStatus, OutboxState> = { ACCEPTED: 'confirmed', FLAGGED: 'flagged', DUPLICATE: 'duplicate', STALE: 'stale' };

export function useJurySocket(jurorId: string) {
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const outboxRef = useRef<OutboxEntry[]>([]);
  const policy = useRef(new ReconnectPolicy(500, 20_000, true));

  const commit = useCallback((next: OutboxEntry[]) => {
    outboxRef.current = next;
    setOutbox(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  }, []);

  const update = useCallback((key: string, fn: (e: OutboxEntry) => OutboxEntry) => {
    commit(outboxRef.current.map((e) => (e.submission.idempotencyKey === key ? fn(e) : e)));
  }, [commit]);

  const sendDemo = useCallback(async (entry: OutboxEntry) => {
    update(entry.submission.idempotencyKey, (e) => ({ ...e, state: 'sending', attempts: e.attempts + 1 }));
    try {
      const res = await fetch(demoApi('/submit'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sheet: entry.submission }),
      });
      const msg = (await res.json()) as JuryServerMessage;
      if (msg.type === 'ack') update(msg.idempotencyKey, (e) => ({ ...e, state: STATE_FROM_ACK[msg.status] }));
      else if (msg.type === 'reject') update(msg.idempotencyKey, (e) => ({ ...e, state: 'rejected' }));
      else update(msg.idempotencyKey, (e) => ({ ...e, state: 'queued', nextAttemptAt: Date.now() + msg.retryAfterMs }));
    } catch {
      update(entry.submission.idempotencyKey, (e) => ({ ...e, state: 'queued', nextAttemptAt: Date.now() + 3000 }));
    }
  }, [update]);

  const flush = useCallback(() => {
    if (!usesGateway) {
      const now = Date.now();
      for (const entry of outboxRef.current) {
        if (entry.state !== 'queued' || entry.nextAttemptAt > now) continue;
        void sendDemo(entry);
      }
      return;
    }
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    for (const entry of outboxRef.current) {
      if (entry.state !== 'queued' || entry.nextAttemptAt > now) continue;
      update(entry.submission.idempotencyKey, (e) => ({ ...e, state: 'sending', attempts: e.attempts + 1 }));
      ws.send(JSON.stringify({ type: 'submit', sheet: entry.submission }));
    }
  }, [update, sendDemo]);

  useEffect(() => {
    if (!jurorId) return;
    commit(load());

    if (!usesGateway) {
      setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
      const tick = setInterval(flush, 1500);
      const onLine = () => { setOnline(true); flush(); };
      const offLine = () => setOnline(false);
      window.addEventListener('online', onLine);
      window.addEventListener('offline', offLine);
      flush();
      return () => {
        clearInterval(tick);
        window.removeEventListener('online', onLine);
        window.removeEventListener('offline', offLine);
      };
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl(`/ws/jury?cred=${encodeURIComponent(jurorId)}`));
      socket.current = ws;
      ws.onopen = () => { policy.current.reset(); setOnline(true); flush(); };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as JuryServerMessage;
        if (msg.type === 'ack') update(msg.idempotencyKey, (e) => ({ ...e, state: STATE_FROM_ACK[msg.status] }));
        else if (msg.type === 'reject') update(msg.idempotencyKey, (e) => ({ ...e, state: 'rejected' }));
        else update(msg.idempotencyKey, (e) => ({ ...e, state: 'queued', nextAttemptAt: Date.now() + msg.retryAfterMs }));
      };
      ws.onclose = () => {
        setOnline(false);
        commit(outboxRef.current.map((e) => (e.state === 'sending' ? { ...e, state: 'queued' as const } : e)));
        if (!disposed) timer = setTimeout(connect, policy.current.next());
      };
      ws.onerror = () => ws.close();
    };
    connect();

    const tick = setInterval(flush, 1500);
    const wake = () => flush();
    window.addEventListener('online', wake);
    return () => {
      disposed = true;
      clearInterval(tick);
      window.removeEventListener('online', wake);
      if (timer) clearTimeout(timer);
      socket.current?.close();
    };
  }, [jurorId, flush, update, commit]);

  const submit = useCallback((table: number, station: number, municipality: number, votes: Votes, voters: number, photoHash: string) => {
    const sheetId = sheetIdOf(station, table);
    const previous = outboxRef.current.filter((e) => e.submission.sheetId === sheetId);
    const version = previous.reduce((max, e) => Math.max(max, e.submission.version), 0) + 1;
    const submission: SheetSubmission = {
      sheetId, table, station, municipality, version, jurorId, closedAt: Math.floor(Date.now() / 1000), votes, voters, photoHash,
      idempotencyKey: crypto.randomUUID(),
    };
    commit([{ submission, state: 'queued', attempts: 0, nextAttemptAt: 0 }, ...outboxRef.current]);
    setTimeout(flush, 0);
    return version;
  }, [jurorId, commit, flush]);

  const pending = outbox.filter((e) => !TERMINAL.includes(e.state)).length;
  return { outbox, online, pending, submit };
}
