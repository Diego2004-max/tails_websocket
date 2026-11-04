import { NextResponse } from 'next/server';

/**
 * The in-process stand-in answers only when the UI is not pointed at the real gateway.
 * One source of truth: either Redis of the gateway, or this document.
 */
export function demoEnabled(): boolean {
  return !(process.env.NEXT_PUBLIC_GATEWAY_URL ?? '').trim();
}

export function demoGuard(): NextResponse | null {
  if (!demoEnabled()) return NextResponse.json({ error: 'El front está conectado al gateway' }, { status: 404 });
  return null;
}
