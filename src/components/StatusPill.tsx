import type { StreamStatus } from '@/lib/useResultsStream';
import { formatClock } from '@/lib/format';

const TEXT: Record<StreamStatus, [string, 'ok' | 'warn' | 'error' | 'idle']> = {
  connecting: ['Conectando…', 'idle'],
  live: ['En vivo', 'ok'],
  reconnecting: ['Reconectando. Conservas lo último que viste.', 'warn'],
  degraded: ['Sin actualización reciente', 'error'],
};

export function StatusPill({ status, lastUpdate }: { status: StreamStatus; lastUpdate: number | null }) {
  const [text, tone] = TEXT[status];
  return (
    <span className="pill" data-tone={tone} role="status">
      <i />
      {text}
      {status === 'live' && lastUpdate ? ` · ${formatClock(lastUpdate)}` : ''}
    </span>
  );
}
