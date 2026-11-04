import { formatInt, formatPercent } from '@/lib/format';

/** 100 cells = 100 % of the tables. Filled cells (ink) vs empty cells (outline): shape, not hue. */
export function CoverageStrip({ reported, total }: { reported: number; total: number }) {
  const ratio = total ? reported / total : 0;
  const filled = Math.round(ratio * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-heading">Mesas informadas</p>
        <p className="type-num-lg">{formatPercent(ratio)}</p>
      </div>
      <div role="img" aria-label={`${formatInt(reported)} de ${formatInt(total)} mesas informadas`} className="mt-2 grid grid-cols-[repeat(50,1fr)] gap-px">
        {Array.from({ length: 100 }, (_, i) => (
          <div key={i} className={`h-2 rounded-xs ${i < filled ? 'bg-primary' : 'bg-outline'}`} />
        ))}
      </div>
      <p className="type-label mt-2 text-secondary">{formatInt(reported)} de {formatInt(total)} mesas</p>
    </div>
  );
}
