import { NextResponse } from 'next/server';
import type { Votes } from '@shared/domain';
import { auditAction, auditState } from '@/demo/engine';
import { withDemo } from '@/demo/sync';
import { demoGuard } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  const url = new URL(req.url);
  const auditor = url.searchParams.get('auditor') ?? undefined;
  const state = await withDemo(() => auditState(auditor));
  return NextResponse.json({ type: 'state', ...state });
}

export async function POST(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  const msg = await req.json();
  const auditorId = String(msg.auditorId ?? '').slice(0, 32);

  return withDemo(() => {
  if (msg.type === 'take') {
    const r = auditAction({ type: 'take', sheetId: msg.sheetId, auditorId });
    if (!r.ok) return NextResponse.json({ type: 'take_denied', sheetId: msg.sheetId, reason: r.code === 'LOCKED' ? 'LOCKED' : 'NOT_IN_QUEUE', by: r.by });
    const data = r.data as { sheetId: string; token: string };
    return NextResponse.json({ type: 'taken', sheetId: data.sheetId, token: data.token });
  }
  if (msg.type === 'renew') {
    const r = auditAction({ type: 'renew', sheetId: msg.sheetId, token: msg.token });
    if (!r.ok) return NextResponse.json({ type: 'lock_lost', sheetId: msg.sheetId });
    return NextResponse.json({ ok: true });
  }
  if (msg.type === 'release') {
    auditAction({ type: 'release', sheetId: msg.sheetId, token: msg.token });
    return NextResponse.json({ ok: true });
  }
  if (msg.type === 'resolve') {
    const r = auditAction({
      type: 'resolve',
      sheetId: msg.sheetId,
      token: msg.token,
      votes: msg.votes as Votes,
      voters: msg.voters,
      auditorId,
    });
    if (!r.ok) {
      if (r.code === 'LOCK_LOST') return NextResponse.json({ type: 'lock_lost', sheetId: msg.sheetId });
      return NextResponse.json({ type: 'error', code: r.code, message: r.message ?? 'Error' });
    }
    return NextResponse.json({ type: 'resolved', sheetId: msg.sheetId });
  }
  return NextResponse.json({ type: 'error', code: 'INVALID', message: 'Acción desconocida' });
  });
}
