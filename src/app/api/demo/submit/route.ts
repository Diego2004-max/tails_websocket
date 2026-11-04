import { NextResponse } from 'next/server';
import { sheetIdOf, validLocation } from '@shared/domain';
import type { SheetSubmission } from '@shared/protocol';
import { ingest } from '@/demo/engine';
import { getDemoState } from '@/demo/state';
import { withDemo } from '@/demo/sync';
import { demoGuard } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  let body: { sheet?: SheetSubmission };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ type: 'reject', idempotencyKey: 'unknown', reason: 'BAD_REQUEST' });
  }
  const sheet = body.sheet;
  const locationOk = !!sheet && validLocation(sheet.table, sheet.station, sheet.municipality) && sheet.sheetId === sheetIdOf(sheet.station, sheet.table);
  if (!sheet?.idempotencyKey || !locationOk) {
    return NextResponse.json({ type: 'reject', idempotencyKey: sheet?.idempotencyKey ?? 'unknown', reason: 'INVALID_SHEET' });
  }
  try {
    const result = await withDemo(() => {
      getDemoState().metrics.juryPosts++;
      return ingest(sheet);
    });
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
