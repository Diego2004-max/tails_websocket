/**
 * Every key shares the {bal} hash tag so all of them map to the same slot if the
 * deployment ever moves to Redis Cluster (required for multi-key Lua scripts).
 */
const T = '{bal}';

export const keys = {
  idem: (k: string) => `${T}:idem:${k}`,
  sheet: (id: string) => `${T}:sheet:${id}`,
  agg: (level: 'tbl' | 'pst' | 'mun' | 'dept', id: number) => `${T}:agg:${level}:${id}`,
  rank: (level: 'pst' | 'mun' | 'dept', id: number) => `${T}:rank:${level}:${id}`,
  events: `${T}:events`,
  lastId: `${T}:last_id`,
  queue: `${T}:queue`,
  lock: (sheetId: string) => `${T}:lock:${sheetId}`,
  presenceIndex: `${T}:presence`,
  presence: (id: string) => `${T}:presence:${id}`,
  rate: (cred: string, window: number) => `${T}:rate:${cred}:${window}`,
  metrics: (instance: string) => `${T}:metrics:${instance}`,
  metricsPattern: `${T}:metrics:*`,
  all: `${T}:*`,
  /** Pub/Sub channel names are not keys, but we keep the same prefix for readability. */
  channel: {
    topic: (topic: string) => `${T}:ch:${topic}`,
    queue: `${T}:ch:queue`,
    prefix: `${T}:ch:`,
  },
};
