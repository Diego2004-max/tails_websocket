const TZ = 'America/Bogota';
const int = new Intl.NumberFormat('es-CO');
const dec = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('es-CO', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const formatInt = (n: number): string => int.format(n);
export const formatPercent = (ratio: number): string => `${dec.format(ratio * 100)} %`;

/** Wall clock in Colombia (UTC−5), 24 h. */
export const formatClock = (ms: number): string => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return clock.format(d);
};

/** Elapsed time. A bad clock difference is not shown as a huge or negative number. */
export const formatElapsed = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0 || ms > 12 * 60 * 60 * 1000) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export const CANDIDATE_LABEL: Record<string, string> = {
  C1: 'C1', C2: 'C2', C3: 'C3', BLANK: 'Blanco', NULL: 'Nulo', UNMARKED: 'No marcado',
};
export const CANDIDATE_BG: Record<string, string> = {
  C1: 'bg-cand-1', C2: 'bg-cand-2', C3: 'bg-cand-3', BLANK: 'bg-blank', NULL: 'bg-null', UNMARKED: 'bg-unmarked',
};
