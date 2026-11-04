import { NextResponse } from 'next/server';
import type { SheetSubmission } from '@shared/protocol';
import { ingest } from '@/demo/engine';
import { getDemoState } from '@/demo/state';
import { demoGuard } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  getDemoState().metrics.juryPosts++;
  let body: { sheet?: SheetSubmission };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ type: 'reject', idempotencyKey: 'unknown', reason: 'BAD_REQUEST' });
  }
  const sheet = body.sheet;
  if (!sheet?.idempotencyKey || !sheet.sheetId) {
    return NextResponse.json({ type: 'reject', idempotencyKey: sheet?.idempotencyKey ?? 'unknown', reason: 'INVALID_SHEET' });
  }
  try {
    const result = ingest(sheet);
    return NextResponse.json({ type: 'ack', idempotencyKey: sheet.idempotencyKey, status: result.status, version: result.version });
  } catch {
    return NextResponse.json({
      type: 'nack',
      idempotencyKey: sheet.idempotencyKey,
      code: 'UNAVAILABLE',
      retryAfterMs: 3000,
    });
  }
}
