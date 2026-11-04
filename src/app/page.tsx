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
  const { snapshot, status, corrections, lastUpdate } = useResultsStream(topic);
  const leader = snapshot?.ranking[0];
  const counted = snapshot ? snapshot.ranking.reduce((a, r) => a + r.votes, 0) : 0;
  const reported = snapshot?.totals.tables ?? 0;

  return (
    <div className="page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="page-title">
          <h1 className="type-display">Preconteo en vivo</h1>
          <p className="type-body-sm max-w-2xl text-secondary">
            Reporte informativo. El conteo oficial es manual y se hace sobre las actas físicas en los días siguientes.
          </p>
        </div>
        <StatusPill status={status} lastUpdate={lastUpdate} />
      </header>

      <div className="card flex flex-wrap items-center justify-between gap-4 py-3!">
        <TopicPicker onChange={setTopic} />
      </div>

      {status === 'degraded' && (
        <p className="notice" role="alert">Sin actualización reciente. Lo que ves es lo último confirmado.</p>
      )}
      {corrections > 0 && (
        <p className="notice">Se corrigieron {formatInt(corrections)} {corrections === 1 ? 'acta' : 'actas'} desde que abriste la página.</p>
      )}

      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <section className="card flex flex-col justify-between gap-4" aria-live="polite">
          <p className="type-label text-secondary">{counted > 0 ? 'Va adelante' : reported > 0 ? 'Mesas informadas, sin votos aún' : 'Esperando actas'}</p>
          {counted > 0 && leader ? (
            <>
              <p className="type-num-xl">{CANDIDATE_LABEL[leader.candidate]}</p>
              <p className="type-body-sm text-secondary">{formatInt(leader.votes)} votos de {formatInt(counted)} contados</p>
            </>
          ) : (
            <p className="type-num-xl">{formatInt(reported)}</p>
          )}
          {counted === 0 && <p className="type-body-sm text-secondary">{reported > 0 ? 'mesas ya transmitidas' : 'Cuando un jurado transmita un acta que cuadre, el total aparece aquí.'}</p>}
        </section>

        <section className="card min-h-80">
          {snapshot ? (
            <div className="grid gap-6">
              <TallyStrip totals={snapshot.totals} />
              <CoverageStrip reported={snapshot.totals.tables ?? 0} total={snapshot.tablesTotal} />
              <dl className="grid grid-cols-3 gap-4 border-t border-outline pt-4">
                {(['BLANK', 'NULL', 'UNMARKED'] as const).map((k) => (
                  <div key={k}>
                    <dt className="type-label text-secondary">{CANDIDATE_LABEL[k]}</dt>
                    <dd className="type-num-lg">{formatInt(snapshot.totals[k] ?? 0)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div className="grid h-full content-center gap-4" aria-busy="true">
              <div className="skeleton h-28 w-full" />
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          )}
        </section>
      </div>

      <InpBadge />
    </div>
  );
}
