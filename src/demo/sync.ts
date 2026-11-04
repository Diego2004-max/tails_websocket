import { replaceDemoState, seedGeography, type DemoState, getDemoState } from './state';

/**
 * Shared demo document.
 * Each serverless instance keeps a memory cache and refreshes it from Redis
 * (Upstash REST, the integration Vercel injects). Writes use compare-and-swap
 * on a revision so two juries cannot overwrite each other.
 * Without credentials the cache stays in this process (local `next dev`).
 */

const REV_KEY = 'ballot:demo:rev';
const STATE_KEY = 'ballot:demo:state';

const CAS = `
local rev = redis.call('GET', KEYS[1])
if rev == false then rev = '0' end
if rev ~= ARGV[1] then
  return {0, rev, redis.call('GET', KEYS[2])}
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
return {1, ARGV[2], ARGV[3]}
`;

interface RestConfig {
  url: string;
  token: string;
}

const cache = { rev: '0', loaded: false };

function paired(urlKey: string, tokenKey: string): RestConfig | null {
  const url = process.env[urlKey];
  const token = process.env[tokenKey];
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

/** Upstash free on Vercel injects these names, sometimes prefixed with the store name. */
function restConfig(): RestConfig | null {
  const direct = paired('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN')
    ?? paired('KV_REST_API_URL', 'KV_REST_API_TOKEN');
  if (direct) return direct;
  const urlKey = Object.keys(process.env).find((k) => k.endsWith('UPSTASH_REDIS_REST_URL') || k.endsWith('KV_REST_API_URL'));
  if (!urlKey) return null;
  const tokenKey = urlKey.endsWith('UPSTASH_REDIS_REST_URL')
    ? urlKey.replace(/UPSTASH_REDIS_REST_URL$/, 'UPSTASH_REDIS_REST_TOKEN')
    : urlKey.replace(/KV_REST_API_URL$/, 'KV_REST_API_TOKEN');
  return paired(urlKey, tokenKey);
}

export function storeBackend(): 'redis' | 'memory' {
  return restConfig() ? 'redis' : 'memory';
}

export function storeRevision(): string {
  return cache.rev;
}

async function command<T>(args: unknown[]): Promise<T> {
  const cfg = restConfig();
  if (!cfg) throw new Error('redis not configured');
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const body = (await res.json()) as { result: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

interface FlatState {
  lastStreamId: string;
  streamSeq: number;
  sheets: Record<string, DemoState['sheets'] extends Map<string, infer V> ? V : never>;
  idem: Record<string, DemoState['idem'] extends Map<string, infer V> ? V : never>;
  aggs: Record<string, Record<string, number>>;
  tablesTotal: Record<string, number>;
  queue: Record<string, number>;
  locks: Record<string, { token: string; auditorId: string; expiresAt: number }>;
  presence: Record<string, DemoState['presence'] extends Map<string, infer V> ? V : never>;
  events: DemoState['events'];
  metrics: DemoState['metrics'];
}

function freeze(state: DemoState): string {
  const flat: FlatState = {
    lastStreamId: state.lastStreamId,
    streamSeq: state.streamSeq,
    sheets: Object.fromEntries(state.sheets),
    idem: Object.fromEntries(state.idem),
    aggs: Object.fromEntries(state.aggs),
    tablesTotal: Object.fromEntries(state.tablesTotal),
    queue: Object.fromEntries(state.queue),
    locks: Object.fromEntries(state.locks),
    presence: Object.fromEntries(state.presence),
    events: state.events,
    metrics: state.metrics,
  };
  return JSON.stringify(flat);
}

function thaw(raw: string): DemoState {
  const flat = JSON.parse(raw) as FlatState;
  const state: DemoState = {
    seeded: false,
    lastStreamId: flat.lastStreamId || '0-0',
    streamSeq: flat.streamSeq || 0,
    sheets: new Map(Object.entries(flat.sheets ?? {})),
    idem: new Map(Object.entries(flat.idem ?? {})),
    aggs: new Map(Object.entries(flat.aggs ?? {})),
    tablesTotal: new Map(Object.entries(flat.tablesTotal ?? {}).map(([k, v]) => [k, Number(v)])),
    queue: new Map(Object.entries(flat.queue ?? {}).map(([k, v]) => [k, Number(v)])),
    locks: new Map(Object.entries(flat.locks ?? {})),
    presence: new Map(Object.entries(flat.presence ?? {})),
    events: flat.events ?? [],
    metrics: flat.metrics,
  };
  seedGeography(state);
  return state;
}

/** Load Redis into the process cache when the revision changed. Returns the revision we hold. */
export async function pull(): Promise<string> {
  if (!restConfig()) {
    seedGeography(getDemoState());
    return 'memory';
  }
  const rev = (await command<string | null>(['GET', REV_KEY])) ?? '0';
  if (cache.loaded && rev === cache.rev) return rev;
  const raw = await command<string | null>(['GET', STATE_KEY]);
  if (!raw) {
    const fresh = getDemoState();
    seedGeography(fresh);
    const created = await cas('0', '1', freeze(fresh));
    if (created.ok) {
      cache.rev = '1';
      cache.loaded = true;
      return '1';
    }
    if (created.raw) replaceDemoState(thaw(created.raw));
    cache.rev = created.rev;
    cache.loaded = true;
    return created.rev;
  }
  replaceDemoState(thaw(raw));
  cache.rev = rev;
  cache.loaded = true;
  return rev;
}

async function cas(expected: string, next: string, body: string): Promise<{ ok: boolean; rev: string; raw: string | null }> {
  const result = await command<[number, string, string | null]>(['EVAL', CAS, '2', REV_KEY, STATE_KEY, expected, next, body]);
  const ok = Number(result?.[0]) === 1;
  return { ok, rev: String(result?.[1] ?? expected), raw: result?.[2] ?? null };
}

async function push(expected: string): Promise<boolean> {
  const next = String(Number(expected) + 1);
  const saved = await cas(expected, next, freeze(getDemoState()));
  if (saved.ok) {
    cache.rev = next;
    cache.loaded = true;
    return true;
  }
  if (saved.raw) replaceDemoState(thaw(saved.raw));
  cache.rev = saved.rev;
  cache.loaded = true;
  return false;
}

/** Run a mutation against the shared document. Retries if another instance wrote first. */
export async function withDemo<T>(fn: () => T): Promise<T> {
  if (!restConfig()) {
    seedGeography(getDemoState());
    return fn();
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const rev = await pull();
    const result = fn();
    if (await push(rev)) return result;
  }
  throw new Error('No se pudo guardar el preconteo compartido');
}
