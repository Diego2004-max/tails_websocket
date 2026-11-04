/**
 * One switch for the whole UI.
 * Empty URL: this Next process simulates the tally (memory, or Upstash when those vars exist).
 * Set URL: juror and audit use WebSocket, the public page uses SSE, ops reads the gateway.
 */
export const GATEWAY_URL = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? '').replace(/\/$/, '');

export const usesGateway = GATEWAY_URL.length > 0;

export const demoApi = (path: string) => `/api/demo${path.startsWith('/') ? path : `/${path}`}`;

export const wsUrl = (path: string): string => {
  if (!usesGateway) throw new Error('No hay gateway: el front está simulando el preconteo');
  return GATEWAY_URL.replace(/^http/, 'ws') + path;
};
