import { NextResponse } from 'next/server';

export function demoEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BALLOT_MODE === 'vercel' || process.env.BALLOT_VERCEL_DEMO === '1';
}

export function demoGuard(): NextResponse | null {
  if (!demoEnabled()) return NextResponse.json({ error: 'Demo mode is not enabled' }, { status: 404 });
  return null;
}
