import os from 'node:os';

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : Number(raw);
};

/** Single source of configuration. Everything tunable lives here (KISS, 12-factor). */
export const config = {
  port: num('PORT', 4000),
  instanceId: process.env.INSTANCE_ID ?? process.env.FLY_MACHINE_ID ?? os.hostname(),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',

  /** Coalescing window: one message per topic per window (the "scale trap"). */
  flushIntervalMs: num('FLUSH_INTERVAL_MS', 2000),
  /** Connections written per Event Loop turn before yielding. */
  fanOutBatchSize: num('FANOUT_BATCH_SIZE', 500),

  /** Back-pressure thresholds measured on each connection's pending output bytes. */
  slowClient: {
    highWaterBytes: num('SLOW_HIGH_BYTES', 64 * 1024),
    lowWaterBytes: num('SLOW_LOW_BYTES', 8 * 1024),
    hardLimitBytes: num('SLOW_HARD_BYTES', 512 * 1024),
  },
  /** Demo knob: pad SSE frames so a deliberately slow client fills buffers quickly. */
  ssePadBytes: num('SSE_PAD_BYTES', 0),

  replayLimit: num('REPLAY_LIMIT', 2000),
  streamMaxLen: num('STREAM_MAXLEN', 20_000),
  idempotencyTtlSec: num('IDEMPOTENCY_TTL_SEC', 86_400),

  lock: { ttlMs: num('LOCK_TTL_MS', 30_000) },
  presenceTtlSec: num('PRESENCE_TTL_SEC', 20),
  presenceHeartbeatMs: num('PRESENCE_HEARTBEAT_MS', 8_000),

  rateLimit: { windowSec: num('RATE_WINDOW_SEC', 10), max: num('RATE_MAX', 30) },
  admission: { maxNewConnectionsPerSec: num('ADMISSION_RATE', 2000) },
} as const;
