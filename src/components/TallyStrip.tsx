import { CANDIDATES } from '@shared/domain';
import { CANDIDATE_BG, CANDIDATE_LABEL, formatInt, formatPercent } from '@/lib/format';

/**
 * The protagonist: a single horizontal strip whose segments are the vote share of each
 * candidate. Two encodings so colour is never alone: the width AND the number/name below.
 */
export function TallyStrip({ totals }: { totals: Record<string, number> }) {
  const counted = CANDIDATES.reduce((a, c) => a + (totals[c] ?? 0), 0);
  const summary = CANDIDATES.map((c) => `${CANDIDATE_LABEL[c]} ${formatInt(totals[c] ?? 0)}`).join(', ');

  return (
    <div>
      <div role="img" aria-label={`Reparto de votos: ${summary}`} className="flex h-[72px] w-full gap-px overflow-hidden rounded-xs sm:h-[88px] lg:h-[120px]">
        {counted === 0 ? (
          <div className="flex h-full w-full items-center justify-center bg-outline text-secondary type-body-sm">Sin votos contados</div>
        ) : (
          CANDIDATES.map((c) => {
            const share = (totals[c] ?? 0) / counted;
            return (
              <div key={c} className={`strip-seg ${CANDIDATE_BG[c]} flex items-end p-1`} style={{ width: `${share * 100}%`, transition: 'width 400ms ease-out' }}>
                {share > 0.12 && <span className="type-num-sm text-white mix-blend-normal [text-shadow:0_0_3px_rgba(0,0,0,.45)]">{formatPercent(share)}</span>}
              </div>
            );
          })
        )}
      </div>
      <ul className="mt-4 grid gap-2">
        {CANDIDATES.map((c) => {
          const v = totals[c] ?? 0;
          return (
            <li key={c} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 type-heading">
                <span className={`inline-block h-3 w-3 rounded-xs ${CANDIDATE_BG[c]}`} aria-hidden />
                {CANDIDATE_LABEL[c]}
              </span>
              <span className="type-num-lg text-right">{formatInt(v)}</span>
              <span className="type-num-md w-20 text-right text-secondary">{counted ? formatPercent(v / counted) : '—'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
