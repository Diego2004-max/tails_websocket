import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { Metrics } from './metrics/Metrics';
import { AuditHub } from './realtime/AuditHub';
import { Backplane } from './realtime/Backplane';
import { JuryHub } from './realtime/JuryHub';
import { PublicHub } from './realtime/PublicHub';
import { createRedis, isRedisReady } from './redis/client';
import { HistoryService } from './services/HistoryService';
import { LockService } from './services/LockService';
import { PresenceService } from './services/PresenceService';
import { RateLimiter } from './services/RateLimiter';
import { SheetService } from './services/SheetService';
import { SnapshotService } from './services/SnapshotService';
import { parseTopic } from '../../shared/domain';

// Composition root: the only place that knows concrete classes (Dependency Inversion).
const redis = createRedis('command');
const subscriber = createRedis('subscriber');
const metrics = new Metrics(redis);
const backplane = new Backplane(subscriber);
const snapshots = new SnapshotService(redis);
const history = new HistoryService(redis);
const sheets = new SheetService(redis);
const locks = new LockService(redis);
const presence = new PresenceService(redis);
const limiter = new RateLimiter(redis);

const publicHub = new PublicHub(backplane, snapshots, history, metrics);
const juryHub = new JuryHub(sheets, limiter, metrics);
const auditHub = new AuditHub(redis, locks, presence, sheets, limiter, metrics);
backplane.onQueue(() => auditHub.scheduleBroadcast());

const cors = {
  'Access-Control-Allow-Origin': config.allowedOrigin,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'X-Instance-Id': config.instanceId,
};
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
  res.end(JSON.stringify(body));
};

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://gateway');
  if (req.method === 'OPTIONS') return void (res.writeHead(204, cors), res.end());

  switch (url.pathname) {
    case '/sse/results':
      return publicHub.handle(req, res, url);
    case '/instance': // RT-1 / RT-2: which instance answered?
      return json(res, 200, { instanceId: config.instanceId });
    case '/healthz': {
      const ok = isRedisReady(redis);
      return json(res, ok ? 200 : 503, { instanceId: config.instanceId, redis: ok ? 'ready' : 'down', degraded: !ok });
    }
    case '/metrics':
      return json(res, 200, metrics.snapshot());
    case '/metrics/cluster':
      return json(res, 200, { instances: await metrics.cluster().catch(() => []) });
    case '/snapshot': { // plain polling fallback
      const parsed = parseTopic(url.searchParams.get('topic'));
      if (!parsed) return json(res, 400, { error: 'invalid topic' });
      return json(res, 200, await snapshots.read(parsed.topic));
    }
    case '/presence':
      return json(res, 200, { presence: await presence.list() });
    default:
      return json(res, 404, { error: 'not found' });
  }
}

const server = createServer((req, res) => {
  route(req, res).catch(() => {
    if (!res.headersSent) json(res, 503, { error: 'unavailable' });
    else res.end();
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://gateway');
  if (url.pathname !== '/ws/jury' && url.pathname !== '/ws/audit') return void socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === '/ws/jury') juryHub.attach(ws, req, url);
    else auditHub.attach(ws, url);
  });
});

// Redis health -> explicit degraded mode for the public audience.
setInterval(() => void publicHub.setDegraded(!isRedisReady(redis)), 2000).unref();

async function main() {
  await backplane.subscribeQueue();
  await snapshots.seedTotals().catch((e) => console.error('[seed] waiting for redis', e.message));
  metrics.start();
  server.listen(config.port, () => console.log(`[gateway] ${config.instanceId} listening on :${config.port}`));
}
void main();

// Graceful shutdown: tell clients to reconnect at a random moment instead of all at once.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await publicHub.shutdown();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}
