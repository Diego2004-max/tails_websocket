'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { compareStreamIds, type Topic } from '@shared/domain';
import type { DeltaMessage, Snapshot, SyncMessage } from '@shared/protocol';
import { ReconnectPolicy } from '@shared/reconnect';
import { demoApi, GATEWAY_URL } from './gateway';
import { IS_VERCEL_DEMO } from './mode';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'degraded';

export interface ResultsView {
  snapshot: Snapshot | null;
  status: StreamStatus;
  corrections: number;
  lastUpdate: number | null;
  reconnects: number;
}

function applyDelta(snap: Snapshot, delta: Record<string, number>, id: string): Snapshot {
  const totals = { ...snap.totals };
  for (const [k, v] of Object.entries(delta)) totals[k] = (totals[k] ?? 0) + v;
  const ranking = snap.ranking
    .map((r) => ({ candidate: r.candidate, votes: totals[r.candidate] ?? 0 }))
    .sort((a, b) => b.votes - a.votes);
  return { ...snap, totals, ranking, id };
}

const POLL_MS = 2000;

/**
 * Public results: SSE against the gateway, or HTTP polling on Vercel demo mode.
 */
export function useResultsStream(topic: Topic): ResultsView {
  const [view, setView] = useState<ResultsView>({ snapshot: null, status: 'connecting', corrections: 0, lastUpdate: null, reconnects: 0 });
  const lastId = useRef<string | undefined>(undefined);
  const policy = useRef(new ReconnectPolicy(500, 30_000, true));

  const patch = useCallback((p: Partial<ResultsView> | ((v: ResultsView) => Partial<ResultsView>)) => {
    setView((v) => ({ ...v, ...(typeof p === 'function' ? p(v) : p) }));
  }, []);

  useEffect(() => {
    if (IS_VERCEL_DEMO) {
      let disposed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      lastId.current = undefined;
      setView({ snapshot: null, status: 'connecting', corrections: 0, lastUpdate: null, reconnects: 0 });

      const merge = (msg: DeltaMessage) => {
        patch((v) => {
          if (!v.snapshot) return {};
          if (compareStreamIds(msg.id, v.snapshot.id) <= 0 && Object.keys(msg.delta).length > 0) return {};
          lastId.current = msg.id;
          return {
            snapshot: applyDelta(v.snapshot, msg.delta, msg.id),
            corrections: v.corrections + msg.corrections,
            lastUpdate: Date.now(),
            status: 'live',
          };
        });
      };

      const tick = async () => {
        if (disposed) return;
        try {
          const url = new URL(demoApi('/poll'), window.location.origin);
          url.searchParams.set('topic', topic);
          if (lastId.current) url.searchParams.set('since', lastId.current);
          const res = await fetch(url.toString(), { cache: 'no-store' });
          if (!res.ok) throw new Error('poll failed');
          const body = await res.json() as { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'delta'; message: DeltaMessage | null; lastId: string };
          if (body.kind === 'snapshot') {
            lastId.current = body.snapshot.id;
            patch({ snapshot: body.snapshot, status: 'live', lastUpdate: Date.now() });
          } else if (body.message) {
            merge(body.message);
          } else if (body.lastId) {
            lastId.current = body.lastId;
          }
        } catch {
          patch({ status: 'degraded' });
        }
      };

      void tick();
      timer = setInterval(() => void tick(), POLL_MS);
      return () => {
        disposed = true;
        if (timer) clearInterval(timer);
      };
    }

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    lastId.current = undefined;
    policy.current.reset();
    setView({ snapshot: null, status: 'connecting', corrections: 0, lastUpdate: null, reconnects: 0 });

    const merge = (msg: DeltaMessage | SyncMessage) => {
      patch((v) => {
        if (!v.snapshot) return {};
        if (compareStreamIds(msg.id, v.snapshot.id) <= 0 && Object.keys(msg.delta).length > 0) return {};
        lastId.current = msg.id;
        return { snapshot: applyDelta(v.snapshot, msg.delta, msg.id), corrections: v.corrections + msg.corrections, lastUpdate: Date.now(), status: 'live' };
      });
    };

    const connect = () => {
      if (disposed) return;
      const url = new URL(`${GATEWAY_URL}/sse/results`);
      url.searchParams.set('topic', topic);
      if (lastId.current) url.searchParams.set('lastId', lastId.current);
      source = new EventSource(url.toString());

      source.addEventListener('snapshot', (e) => {
        const snap = JSON.parse((e as MessageEvent).data) as Snapshot;
        lastId.current = snap.id;
        policy.current.reset();
        patch({ snapshot: snap, status: 'live', lastUpdate: Date.now() });
      });
      source.addEventListener('sync', (e) => {
        policy.current.reset();
        merge(JSON.parse((e as MessageEvent).data) as SyncMessage);
      });
      source.addEventListener('delta', (e) => merge(JSON.parse((e as MessageEvent).data) as DeltaMessage));
      source.addEventListener('status', (e) => {
        const { degraded } = JSON.parse((e as MessageEvent).data) as { degraded: boolean };
        patch({ status: degraded ? 'degraded' : 'live' });
      });
      source.addEventListener('reconnect', (e) => {
        const { afterMs } = JSON.parse((e as MessageEvent).data) as { afterMs: number };
        source?.close();
        patch({ status: 'reconnecting' });
        timer = setTimeout(connect, afterMs);
      });
      source.onerror = () => {
        source?.close();
        patch((v) => ({ status: 'reconnecting', reconnects: v.reconnects + 1 }));
        timer = setTimeout(connect, policy.current.next());
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [topic, patch]);

  return view;
}
