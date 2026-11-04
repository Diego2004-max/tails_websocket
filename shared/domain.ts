// Pure domain types and helpers shared by the gateway and the Next.js frontend.
// No runtime dependencies on purpose (KISS): both sides can bundle it.

export const CANDIDATES = ['C1', 'C2', 'C3'] as const;
export type CandidateId = (typeof CANDIDATES)[number];

export const VOTE_KEYS = [...CANDIDATES, 'BLANK', 'NULL', 'UNMARKED'] as const;
export type VoteKey = (typeof VOTE_KEYS)[number];
export type Votes = Record<VoteKey, number>;

export const GEOGRAPHY = { tables: 6400, stations: 1842, municipalities: 42 } as const;

export type TopicLevel = 'dept' | 'mun' | 'pst';
export type Topic = 'dept' | `mun:${number}` | `pst:${number}`;

/** Deterministic geography: the server is the source of truth, clients never send it. */
export function stationOfTable(table: number): number {
  return Math.ceil((table * GEOGRAPHY.stations) / GEOGRAPHY.tables);
}
export function municipalityOfStation(station: number): number {
  return ((station - 1) % GEOGRAPHY.municipalities) + 1;
}
export function locate(table: number) {
  const station = stationOfTable(table);
  return { table, station, municipality: municipalityOfStation(station) };
}

export function sheetIdOf(table: number): string {
  const { station } = locate(table);
  return `E14-${String(station).padStart(4, '0')}-${String(table).padStart(4, '0')}-01`;
}

export function parseTopic(raw: string | null | undefined): { level: TopicLevel; id: number; topic: Topic } | null {
  if (!raw) return null;
  if (raw === 'dept') return { level: 'dept', id: 1, topic: 'dept' };
  const m = /^(mun|pst):(\d{1,4})$/.exec(raw);
  if (!m) return null;
  const level = m[1] as 'mun' | 'pst';
  const id = Number(m[2]);
  const max = level === 'mun' ? GEOGRAPHY.municipalities : GEOGRAPHY.stations;
  if (id < 1 || id > max) return null;
  return { level, id, topic: raw as Topic };
}

/** Topics that must hear about a sheet located at (station, municipality). */
export function topicsOf(station: number, municipality: number): Topic[] {
  return ['dept', `mun:${municipality}`, `pst:${station}`];
}

/** Accounting rule: every vote bucket must add up to the number of voters. */
export function sumVotes(votes: Votes): number {
  return VOTE_KEYS.reduce((acc, k) => acc + (votes[k] ?? 0), 0);
}
export function balances(votes: Votes, voters: number): boolean {
  return sumVotes(votes) === voters;
}

/** Redis stream ids look like "1793577600123-0": compare them numerically. */
export function compareStreamIds(a: string, b: string): number {
  const [am, as = '0'] = a.split('-');
  const [bm, bs = '0'] = b.split('-');
  const dm = Number(am) - Number(bm);
  return dm !== 0 ? Math.sign(dm) : Math.sign(Number(as) - Number(bs));
}
export function isStreamId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,16}-\d{1,10}$/.test(v);
}
