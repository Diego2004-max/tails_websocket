import { NextResponse } from 'next/server';
import { storeBackend, storeRevision } from '@/demo/sync';
import { demoGuard } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const blocked = demoGuard();
  if (blocked) return blocked;
  return NextResponse.json({
    ok: true,
    mode: 'vercel-demo',
    backend: storeBackend(),
    revision: storeRevision(),
    redis: storeBackend() === 'redis' ? 'shared' : 'memory',
  });
}
