import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { JuryServerMessage } from '../../../../shared/protocol';
import type { RuntimeMetrics } from '../../platform/metrics/Metrics';
import type { RateGate } from '../../platform/rate-limit/RateLimiter';
import { submissionSchema, UnavailableError, type SheetIngest } from '../sheets';

/**
 * Jurors: WebSocket. They need a bidirectional channel with an explicit, per-sheet answer.
 * Every submission gets exactly one terminal answer (ack / reject) or a retryable nack.
 */
export class JuryHub {
  constructor(
    private readonly sheets: SheetIngest,
    private readonly limiter: RateGate,
    private readonly metrics: RuntimeMetrics,
  ) {}

  attach(ws: WebSocket, req: IncomingMessage, url: URL): void {
    const credential = url.searchParams.get('cred') ?? 'anonymous';
    this.metrics.connections.jury++;
    ws.on('close', () => this.metrics.connections.jury--);
    ws.on('error', () => undefined);

    ws.on('message', async (raw) => {
      let key = 'unknown';
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type !== 'submit') return;
        key = String(msg.sheet?.idempotencyKey ?? 'unknown');

        const parsed = submissionSchema.safeParse(msg.sheet);
        if (!parsed.success) return this.send(ws, { type: 'reject', idempotencyKey: key, reason: 'INVALID_SHEET' });

        const rate = await this.limiter.hit(credential);
        if (!rate.allowed) {
          return this.send(ws, { type: 'nack', idempotencyKey: key, code: 'RATE_LIMITED', retryAfterMs: rate.retryAfterSec * 1000 });
        }

        const result = await this.sheets.ingest(parsed.data);
        if (result.status === 'ACCEPTED' || result.status === 'FLAGGED') this.metrics.recordSheet();
        this.send(ws, { type: 'ack', idempotencyKey: key, status: result.status, version: result.version });
      } catch (err) {
        if (err instanceof UnavailableError) {
          // Degraded mode: never stay silent. The juror keeps the sheet queued and retries.
          this.send(ws, { type: 'nack', idempotencyKey: key, code: 'UNAVAILABLE', retryAfterMs: 3000 + Math.floor(Math.random() * 3000) });
        } else {
          this.send(ws, { type: 'reject', idempotencyKey: key, reason: 'BAD_REQUEST' });
        }
      }
    });
  }

  private send(ws: WebSocket, msg: JuryServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
