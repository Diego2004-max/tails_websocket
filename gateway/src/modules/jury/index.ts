import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { RuntimeMetrics } from '../../platform/metrics/Metrics';
import type { RateGate } from '../../platform/rate-limit/RateLimiter';
import type { SheetIngest } from '../sheets';
import { JuryHub } from './JuryHub';

/** Jurors. The WebSocket is the adapter; a controller would only forward the same message. */
export interface JuryModule {
  attach(ws: WebSocket, req: IncomingMessage, url: URL): void;
}

export function createJury(sheets: SheetIngest, limiter: RateGate, metrics: RuntimeMetrics): JuryModule {
  const hub = new JuryHub(sheets, limiter, metrics);
  return { attach: (ws, req, url) => hub.attach(ws, req, url) };
}
