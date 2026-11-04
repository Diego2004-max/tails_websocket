import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { route, json } from './http/router';
import { createBroadcast } from './modules/broadcast';
import { createJury } from './modules/jury';
import { createVerification } from './modules/verification';
import { SheetService } from './modules/sheets';
import { Backplane } from './platform/bus/Backplane';
import { config } from './platform/config';
import { Metrics } from './platform/metrics/Metrics';
import { RateLimiter } from './platform/rate-limit/RateLimiter';
import { createRedis, isRedisReady } from './platform/redis/client';

// Composition root: the only file that constructs modules and connects them.
const redis = createRedis('command');
const subscriber = createRedis('subscriber');
const metrics = new Metrics(redis);
const backplane = new Backplane(subscriber);
const sheets = new SheetService(redis);
const limiter = new RateLimiter(redis);

const broadcast = createBroadcast(backplane, redis, metrics);
const jury = createJury(sheets, limiter, metrics);
const verification = createVerification(redis, sheets, limiter, metrics);
backplane.onQueue(() => verification.scheduleBroadcast());

const modules = { broadcast, verification, metrics, redis };

const server = createServer((req, res) => {
  route(modules, req, res).catch(() => {
    if (!res.headersSent) json(res, 503, { error: 'unavailable' });
    else res.end();
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://gateway');
  if (url.pathname !== '/ws/jury' && url.pathname !== '/ws/audit') return void socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === '/ws/jury') jury.attach(ws, req, url);
    else verification.attach(ws, url);
  });
});

// Redis health -> explicit degraded mode for the public audience.
setInterval(() => void broadcast.setDegraded(!isRedisReady(redis)), 2000).unref();

async function main() {
  await backplane.subscribeQueue();
  await broadcast.seedTotals().catch((e) => console.error('[seed] waiting for redis', e.message));
  metrics.start();
  server.listen(config.port, () => console.log(`[gateway] ${config.instanceId} listening on :${config.port}`));
}
void main();

// Graceful shutdown: tell clients to reconnect at a random moment instead of all at once.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await broadcast.shutdown();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}
