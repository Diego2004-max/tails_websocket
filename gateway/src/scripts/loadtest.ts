/**
 * Reproducible load test (RT-8).
 *   npm run loadtest -- --target http://localhost:8080 --sse 20000 --jurors 200 --minutes 2
 *
 * - Opens N public SSE connections (5% dept, 60% municipality, 35% station).
 * - Plays the whole day (6,400 sheets) compressed into --minutes, with 55% of the sheets in
 *   the first third of the window, 8% duplicate resends, 3% corrections and 7% unbalanced sheets.
 * - Optionally opens --slow clients that never read (back-pressure demo, RF-9).
 * Tip: raise `ulimit -n` and, for >28k sockets from one machine, use several source IPs.
 */
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { GEOGRAPHY, locate, sheetIdOf, type Votes } from '../../../shared/domain';
import type { SheetSubmission } from '../../../shared/protocol';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const target = new URL(arg('target', 'http://localhost:8080'));
const SSE = Number(arg('sse', '20000'));
const JURORS = Number(arg('jurors', '200'));
const SLOW = Number(arg('slow', '0'));
const MINUTES = Number(arg('minutes', '2'));

const stats = { sseOpen: 0, sseErrors: 0, sseMessages: 0, acks: {} as Record<string, number>, nacks: 0, rejects: 0 };
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

function pickTopic(): string {
  const r = Math.random();
  if (r < 0.05) return 'dept';
  if (r < 0.65) return `mun:${1 + Math.floor(Math.random() * GEOGRAPHY.municipalities)}`;
  return `pst:${1 + Math.floor(Math.random() * GEOGRAPHY.stations)}`;
}

function openSse(): void {
  const req = http.get({ host: target.hostname, port: target.port, path: `/sse/results?topic=${pickTopic()}`, agent }, (res) => {
    if (res.statusCode !== 200) { stats.sseErrors++; res.resume(); return; }
    stats.sseOpen++;
    res.on('data', () => stats.sseMessages++);
    res.on('close', () => stats.sseOpen--);
  });
  req.on('error', () => stats.sseErrors++);
}

function openSlowClient(): void {
  const s = net.connect(Number(target.port || 80), target.hostname, () => {
    s.write(`GET /sse/results?topic=dept HTTP/1.1\r\nHost: ${target.host}\r\nAccept: text/event-stream\r\n\r\n`);
    s.pause(); // never read: the server-side buffer for this client keeps growing
  });
  s.on('error', () => undefined);
}

function randomVotes(balanced: boolean): { votes: Votes; voters: number } {
  const n = () => Math.floor(Math.random() * 250);
  const votes: Votes = { C1: n(), C2: n(), C3: n(), BLANK: Math.floor(Math.random() * 30), NULL: Math.floor(Math.random() * 12), UNMARKED: Math.floor(Math.random() * 6) };
  const sum = Object.values(votes).reduce((a, b) => a + b, 0);
  return { votes, voters: balanced ? sum : sum + 1 + Math.floor(Math.random() * 9) };
}

function playDay(): void {
  const windowMs = MINUTES * 60_000;
  const sockets: WebSocket[] = [];
  for (let i = 0; i < JURORS; i++) {
    const ws = new WebSocket(`ws://${target.host}/ws/jury?cred=JUR-${i}`);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'ack') stats.acks[m.status] = (stats.acks[m.status] ?? 0) + 1;
      else if (m.type === 'nack') stats.nacks++;
      else stats.rejects++;
    });
    ws.on('error', () => undefined);
    sockets.push(ws);
  }
  const send = (sub: SheetSubmission) => {
    const ws = sockets[Math.floor(Math.random() * sockets.length)];
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'submit', sheet: sub }));
  };

  for (let table = 1; table <= GEOGRAPHY.tables; table++) {
    const early = Math.random() < 0.55; // 55% inside the first third of the day
    const at = early ? Math.random() * (windowMs / 3) : (windowMs / 3) + Math.random() * (windowMs * 2 / 3);
    const { votes, voters } = randomVotes(Math.random() > 0.07);
    const place = locate(table);
    const base: SheetSubmission = {
      sheetId: sheetIdOf(place.station, table), table, station: place.station, municipality: place.municipality, version: 1, jurorId: `JUR-${table}`, closedAt: Math.floor(Date.now() / 1000),
      votes, voters, photoHash: 'loadtest-photo', idempotencyKey: randomUUID(),
    };
    setTimeout(() => {
      send(base);
      if (Math.random() < 0.08) for (let r = 0; r < 1 + Math.floor(Math.random() * 4); r++) setTimeout(() => send(base), 300 * (r + 1)); // resends, same key
      if (Math.random() < 0.03) {
        const fixed = randomVotes(true);
        const v3 = { ...base, version: 3, ...fixed, idempotencyKey: randomUUID() };
        const v2 = { ...base, version: 2, ...fixed, idempotencyKey: randomUUID() };
        setTimeout(() => send(v3), 2000); setTimeout(() => send(v2), 2500); // v2 arrives late: must not roll back
      }
    }, at);
  }
}

async function main() {
  console.log(`opening ${SSE} SSE clients against ${target.origin} ...`);
  for (let i = 0; i < SSE; i++) {
    openSse();
    if (i % 500 === 499) await new Promise((r) => setTimeout(r, 250)); // ramp up, avoid self-inflicted storm
  }
  for (let i = 0; i < SLOW; i++) openSlowClient();
  playDay();
  setInterval(() => console.log(JSON.stringify({ t: new Date().toISOString(), ...stats })), 5000);
}
void main();
