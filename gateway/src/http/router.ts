import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseTopic } from '../../../shared/domain';
import type { BroadcastModule } from '../modules/broadcast';
import type { VerificationModule } from '../modules/verification';
import { config } from '../platform/config';
import type { Metrics } from '../platform/metrics/Metrics';
import { isRedisReady, type ScriptedRedis } from '../platform/redis/client';

/**
 * One dispatcher for request/response routes. SSE and WebSocket are not routed here:
 * they are adapters owned by their modules. A controller per path would only rename these calls.
 */
export interface HttpModules {
  broadcast: BroadcastModule;
  verification: VerificationModule;
  metrics: Metrics;
  redis: ScriptedRedis;
}

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

export async function route(modules: HttpModules, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://gateway');
  if (req.method === 'OPTIONS') return void (res.writeHead(204, cors), res.end());

  switch (url.pathname) {
    case '/sse/results':
      return modules.broadcast.handle(req, res, url);
    case '/instance': // RT-1 / RT-2: which instance answered?
      return json(res, 200, { instanceId: config.instanceId });
    case '/healthz': {
      const ok = isRedisReady(modules.redis);
      return json(res, ok ? 200 : 503, { instanceId: config.instanceId, redis: ok ? 'ready' : 'down', degraded: !ok });
    }
    case '/metrics':
      return json(res, 200, modules.metrics.snapshot());
    case '/metrics/cluster':
      return json(res, 200, { instances: await modules.metrics.cluster().catch(() => []) });
    case '/snapshot': {
      const parsed = parseTopic(url.searchParams.get('topic'));
      if (!parsed) return json(res, 400, { error: 'invalid topic' });
      return json(res, 200, await modules.broadcast.readSnapshot(parsed.topic));
    }
    case '/presence':
      return json(res, 200, { presence: await modules.verification.listPresence() });
    default:
      return json(res, 404, { error: 'not found' });
  }
}

export { json };
