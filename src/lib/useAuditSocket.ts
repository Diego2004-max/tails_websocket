'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Votes } from '@shared/domain';
import type { AuditServerMessage, PresenceEntry, QueueItem } from '@shared/protocol';
import { ReconnectPolicy } from '@shared/reconnect';
import { demoApi, usesGateway, wsUrl } from './gateway';

const RENEW_EVERY_MS = 10_000;
const IDLE_AFTER_MS = 5 * 60_000;
const POLL_MS = 2000;

export interface Held { sheetId: string; token: string }

export function useAuditSocket(auditorId: string) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [online, setOnline] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const heldRef = useRef<Held | null>(null);
  const lastActivity = useRef(Date.now());
  const policy = useRef(new ReconnectPolicy(500, 20_000, true));

  const applyAuditMessage = useCallback((msg: AuditServerMessage) => {
    switch (msg.type) {
      case 'state': setQueue(msg.queue); setPresence(msg.presence); setSkew(msg.serverTime - Date.now()); break;
      case 'taken': setHeld({ sheetId: msg.sheetId, token: msg.token }); setNotice(null); break;
      case 'take_denied': setNotice(msg.reason === 'LOCKED' ? `Esa acta ya la tiene ${msg.by ?? 'otra persona'}.` : 'Esa acta ya no está en la cola.'); break;
      case 'lock_lost': setHeld(null); setNotice('Perdiste el bloqueo de esa acta porque venció. Vuelve a tomarla si sigue en la cola.'); break;
      case 'resolved': setHeld(null); setNotice('Acta resuelta. Los totales ya incluyen tu corrección.'); break;
      case 'error': setNotice(msg.message); break;
    }
  }, []);

  const send = useCallback((msg: object) => {
    if (!usesGateway) {
      void fetch(demoApi('/audit'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...msg, auditorId }),
      }).then(async (res) => {
        const data = (await res.json()) as AuditServerMessage;
        applyAuditMessage(data);
      }).catch(() => setNotice('Sin conexión. Reintenta.'));
      return;
    }
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  }, [auditorId, applyAuditMessage]);

  useEffect(() => {
    heldRef.current = held;
  }, [held]);

  useEffect(() => {
    if (!usesGateway) {
      setOnline(true);
      let disposed = false;
      const pull = async () => {
        if (disposed) return;
        try {
          const url = new URL(demoApi('/audit'), window.location.origin);
          url.searchParams.set('auditor', auditorId);
          const res = await fetch(url.toString(), { cache: 'no-store' });
          const msg = (await res.json()) as AuditServerMessage;
          applyAuditMessage(msg);
        } catch {
          setOnline(false);
        }
      };
      void pull();
      const poll = setInterval(pull, POLL_MS);
      const renew = setInterval(() => {
        const h = heldRef.current;
        if (h && Date.now() - lastActivity.current < IDLE_AFTER_MS) send({ type: 'renew', sheetId: h.sheetId, token: h.token });
      }, RENEW_EVERY_MS);
      const touch = () => { lastActivity.current = Date.now(); };
      for (const e of ['pointerdown', 'keydown', 'input']) window.addEventListener(e, touch, { passive: true });
      return () => {
        disposed = true;
        clearInterval(poll);
        clearInterval(renew);
        for (const e of ['pointerdown', 'keydown', 'input']) window.removeEventListener(e, touch);
      };
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl(`/ws/audit?auditor=${encodeURIComponent(auditorId)}`));
      socket.current = ws;
      ws.onopen = () => { policy.current.reset(); setOnline(true); };
      ws.onmessage = (ev) => applyAuditMessage(JSON.parse(ev.data) as AuditServerMessage);
      ws.onclose = () => { setOnline(false); if (!disposed) timer = setTimeout(connect, policy.current.next()); };
      ws.onerror = () => ws.close();
    };
    connect();

    const renew = setInterval(() => {
      const h = heldRef.current;
      if (h && Date.now() - lastActivity.current < IDLE_AFTER_MS) send({ type: 'renew', sheetId: h.sheetId, token: h.token });
    }, RENEW_EVERY_MS);
    const touch = () => { lastActivity.current = Date.now(); };
    for (const e of ['pointerdown', 'keydown', 'input']) window.addEventListener(e, touch, { passive: true });

    return () => {
      disposed = true;
      clearInterval(renew);
      for (const e of ['pointerdown', 'keydown', 'input']) window.removeEventListener(e, touch);
      if (timer) clearTimeout(timer);
      socket.current?.close();
    };
  }, [auditorId, send, applyAuditMessage]);

  return {
    queue, presence, online, held, notice, skew,
    take: (sheetId: string) => send({ type: 'take', sheetId }),
    release: () => { if (held) { send({ type: 'release', ...held }); setHeld(null); } },
    resolve: (votes: Votes, voters: number) => { if (held) send({ type: 'resolve', ...held, votes, voters }); },
  };
}
