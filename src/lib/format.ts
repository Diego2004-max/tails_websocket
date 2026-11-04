const TZ = 'America/Bogota';
const int = new Intl.NumberFormat('es-CO');
const dec = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const formatInt = (n: number): string => int.format(n);
export const formatPercent = (ratio: number): string => `${dec.format(ratio * 100)} %`;
export const formatClock = (ms: number): string => clock.format(ms);
export const formatElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

export const CANDIDATE_LABEL: Record<string, string> = {
  C1: 'C1', C2: 'C2', C3: 'C3', BLANK: 'Blanco', NULL: 'Nulo', UNMARKED: 'No marcado',
};
export const CANDIDATE_BG: Record<string, string> = {
  C1: 'bg-cand-1', C2: 'bg-cand-2', C3: 'bg-cand-3', BLANK: 'bg-blank', NULL: 'bg-null', UNMARKED: 'bg-unmarked',
};
