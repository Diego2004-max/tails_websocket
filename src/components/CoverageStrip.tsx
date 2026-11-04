import { formatInt, formatPercent } from '@/lib/format';

/** 100 cells = 100 % of the tables. Filled cells (ink) vs empty cells (outline): shape, not hue. */
export function CoverageStrip({ reported, total }: { reported: number; total: number }) {
  const ratio = total ? reported / total : 0;
  const filled = Math.round(Math.min(1, ratio) * 100);
  const percent = ratio > 0 && ratio < 0.001 ? '< 0,1 %' : formatPercent(ratio);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-heading">Mesas informadas</p>
        <p className="type-num-lg">{percent}</p>
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
