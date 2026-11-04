import { NextResponse } from 'next/server';
import { parseTopic } from '@shared/domain';
import { readSnapshot } from '@/demo/engine';
import { demoGuard } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  const url = new URL(req.url);
  const parsed = parseTopic(url.searchParams.get('topic'));
  if (!parsed) return NextResponse.json({ error: 'invalid topic' }, { status: 400 });
  return NextResponse.json(await readSnapshot(parsed.topic));
}
