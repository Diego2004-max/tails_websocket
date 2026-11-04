'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { compareStreamIds, type Topic } from '@shared/domain';
import type { DeltaMessage, Snapshot, SyncMessage } from '@shared/protocol';
import { ReconnectPolicy } from '@shared/reconnect';
import { GATEWAY_URL } from './gateway';

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

/**
 * Public stream (SSE). Continuity: we remember the last event id and send it on reconnect, so
 * the server replays what we missed (or sends a snapshot). Reconnection uses full-jitter backoff.
 * Each applied delta is idempotent: anything at or below the current id is ignored.
 */
export function useResultsStream(topic: Topic): ResultsView {
  const [view, setView] = useState<ResultsView>({ snapshot: null, status: 'connecting', corrections: 0, lastUpdate: null, reconnects: 0 });
  const lastId = useRef<string | undefined>(undefined);
  const policy = useRef(new ReconnectPolicy(500, 30_000, true));

  const patch = useCallback((p: Partial<ResultsView> | ((v: ResultsView) => Partial<ResultsView>)) => {
    setView((v) => ({ ...v, ...(typeof p === 'function' ? p(v) : p) }));
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    lastId.current = undefined;
    policy.current.reset();
    setView({ snapshot: null, status: 'connecting', corrections: 0, lastUpdate: null, reconnects: 0 });

    const merge = (msg: DeltaMessage | SyncMessage) => {
      patch((v) => {
        if (!v.snapshot) return {};
        if (compareStreamIds(msg.id, v.snapshot.id) <= 0 && Object.keys(msg.delta).length > 0) return {}; // already applied
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
      // We own the reconnection (jitter + lastId) instead of the browser's fixed-delay retry.
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
