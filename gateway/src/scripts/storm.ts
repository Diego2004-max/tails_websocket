/**
 * Reconnection avalanche demo (RF-10). Compares synchronized retries with full-jitter backoff.
 *   npm run storm -- --target http://localhost:8080 --clients 5000 --mode naive
 *   npm run storm -- --target http://localhost:8080 --clients 5000 --mode jitter
 * Writes storm-<mode>.csv with "second,attempts,accepted,refused" to plot attempts per second.
 */
import http from 'node:http';
import fs from 'node:fs';
import { ReconnectPolicy } from '../../../shared/reconnect';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const target = new URL(arg('target', 'http://localhost:8080'));
const CLIENTS = Number(arg('clients', '5000'));
const MODE = arg('mode', 'jitter') as 'naive' | 'jitter';
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });

const perSecond = new Map<number, { attempts: number; accepted: number; refused: number }>();
let t0 = 0;
const bucket = () => {
  const s = Math.floor((Date.now() - t0) / 1000);
  if (!perSecond.has(s)) perSecond.set(s, { attempts: 0, accepted: 0, refused: 0 });
  return perSecond.get(s)!;
};

function client(): void {
  const policy = new ReconnectPolicy(500, 30_000, MODE === 'jitter');
  const connect = () => {
    bucket().attempts++;
    const req = http.get({ host: target.hostname, port: target.port, path: '/sse/results?topic=dept', agent }, (res) => {
      if (res.statusCode !== 200) { bucket().refused++; res.resume(); return setTimeout(connect, policy.next()); }
      bucket().accepted++;
      policy.reset();
      res.resume();
    });
    req.on('error', () => { bucket().refused++; setTimeout(connect, policy.next()); });
  };
  connect();
}

t0 = Date.now();
console.log(`mode=${MODE}: ${CLIENTS} clients reconnect at once (simulates a dead instance)`);
for (let i = 0; i < CLIENTS; i++) client();

setTimeout(() => {
  const rows = ['second,attempts,accepted,refused'];
  for (const [s, v] of [...perSecond].sort((a, b) => a[0] - b[0])) rows.push(`${s},${v.attempts},${v.accepted},${v.refused}`);
  fs.writeFileSync(`storm-${MODE}.csv`, rows.join('\n'));
  console.log(`wrote storm-${MODE}.csv`);
  process.exit(0);
}, 60_000);
