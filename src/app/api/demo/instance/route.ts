import { NextResponse } from 'next/server';
import { demoGuard } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const blocked = demoGuard();
  if (blocked) return blocked;
  const region = process.env.VERCEL_REGION ?? 'local';
  return NextResponse.json({ instanceId: `vercel-demo-${region}` });
}
