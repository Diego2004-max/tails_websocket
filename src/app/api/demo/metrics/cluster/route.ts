import { NextResponse } from 'next/server';
import { demoMetricsPayload } from '@/demo/engine';
import { demoGuard } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const blocked = demoGuard();
  if (blocked) return blocked;
  const body = demoMetricsPayload();
  return NextResponse.json({ instances: body.instances, note: body.note, mode: body.mode });
}
