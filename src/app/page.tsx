'use client';
import { useState } from 'react';
import type { Topic } from '@shared/domain';
import { CoverageStrip } from '@/components/CoverageStrip';
import { InpBadge } from '@/components/InpBadge';
import { StatusPill } from '@/components/StatusPill';
import { TallyStrip } from '@/components/TallyStrip';
import { TopicPicker } from '@/components/TopicPicker';
import { CANDIDATE_LABEL, formatInt } from '@/lib/format';
import { useResultsStream } from '@/lib/useResultsStream';

export default function PublicResults() {
  const [topic, setTopic] = useState<Topic>('dept');
  const { snapshot, status, corrections } = useResultsStream(topic);
  const leader = snapshot?.ranking[0];
  const counted = snapshot ? snapshot.ranking.reduce((a, r) => a + r.votes, 0) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
      <section className="lg:col-span-8">
        <h1 className="type-display">Preconteo en vivo</h1>
        <p className="type-body-sm mt-2 max-w-prose text-secondary">
          Reporte informativo. El conteo oficial es manual y se hace sobre las actas físicas en los días siguientes.
        </p>
      </section>

      <section className="lg:col-span-4 lg:row-span-1" aria-live="polite">
        <div className="card">
          <p className="type-heading">{leader && counted > 0 ? 'Va adelante' : 'Esperando las primeras actas'}</p>
          {leader && counted > 0 ? (
            <>
              <p className="type-num-xl mt-1">{CANDIDATE_LABEL[leader.candidate]}</p>
              <p className="type-body-sm text-secondary">{formatInt(leader.votes)} votos de {formatInt(counted)} contados</p>
            </>
          ) : (
            <div className="skeleton mt-2 h-12 w-full" />
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:col-span-12 lg:grid-cols-12 lg:gap-8">
        <div className="grid content-start gap-4 lg:col-span-4">
          <TopicPicker onChange={setTopic} />
          <StatusPill status={status} lastUpdate={null} />
          {status === 'degraded' && (
            <p className="notice" role="alert">Los datos no se están actualizando. Lo que ves es lo último confirmado. Vuelve a mirar en unos minutos.</p>
          )}
          {corrections > 0 && (
            <p className="notice">Se corrigieron {formatInt(corrections)} {corrections === 1 ? 'acta' : 'actas'} desde que abriste la página. Por eso algún total pudo bajar.</p>
          )}
        </div>

        <div className="card lg:col-span-8">
          {snapshot ? (
            <div className="grid gap-6">
              <TallyStrip totals={snapshot.totals} />
              <CoverageStrip reported={snapshot.totals.tables ?? 0} total={snapshot.tablesTotal} />
              <dl className="grid grid-cols-3 gap-3">
                {(['BLANK', 'NULL', 'UNMARKED'] as const).map((k) => (
                  <div key={k}>
                    <dt className="type-label text-secondary">{CANDIDATE_LABEL[k]}</dt>
                    <dd className="type-num-lg">{formatInt(snapshot.totals[k] ?? 0)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div className="grid gap-4" aria-busy="true">
              <div className="skeleton h-[72px] w-full sm:h-[88px] lg:h-[120px]" />
              <div className="skeleton h-5 w-2/3" />
              <div className="skeleton h-5 w-1/2" />
            </div>
          )}
        </div>
      </section>

      <footer className="lg:col-span-12">
        <InpBadge />
      </footer>
    </div>
  );
}
