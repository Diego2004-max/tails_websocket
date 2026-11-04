export const GATEWAY_URL = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
export const wsUrl = (path: string): string => GATEWAY_URL.replace(/^http/, 'ws') + path;
