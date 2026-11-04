import { IS_VERCEL_DEMO } from './mode';

/** In demo mode all traffic stays on the same origin (`/api/demo/*`). */
export const GATEWAY_URL = IS_VERCEL_DEMO
  ? ''
  : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export const demoApi = (path: string) => `/api/demo${path.startsWith('/') ? path : `/${path}`}`;

export const wsUrl = (path: string): string => {
  if (IS_VERCEL_DEMO) throw new Error('WebSocket is disabled in Vercel demo mode');
  return GATEWAY_URL.replace(/^http/, 'ws') + path;
};
