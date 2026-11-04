'use client';
import { useEffect, useState } from 'react';
import { balances, VOTE_KEYS, type Votes } from '@shared/domain';
import { CANDIDATE_LABEL, formatElapsed, formatInt } from '@/lib/format';
import { useAuditSocket } from '@/lib/useAuditSocket';

export default function AuditPage() {
  const [auditorId, setAuditorId] = useState('AUD-000');
  useEffect(() => {
    const saved = localStorage.getItem('ballot.auditor') ?? `AUD-${Math.floor(100 + Math.random() * 899)}`;
    localStorage.setItem('ballot.auditor', saved);
    setAuditorId(saved);
  }, []);

  const { queue, presence, online, held, notice, skew, take, release, resolve } = useAuditSocket(auditorId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const current = held ? queue.find((q) => q.sheetId === held.sheetId) : undefined;
  const [draft, setDraft] = useState<Votes | null>(null);
  const [voters, setVoters] = useState(0);
  useEffect(() => {
    if (current && (!draft || held?.sheetId !== current.sheetId)) { setDraft(current.votes); setVoters(current.voters); }
    if (!held) setDraft(null);
  }, [current, held, draft]);

  return (
    <div className="page lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
      <section>
        <h1 className="type-title">Cola de verificación</h1>
        <p className="type-body-sm mt-1 text-secondary">Actas cuyos totales no cuadran, ordenadas por tamaño de la diferencia. Soy {auditorId}.</p>
        <span className="pill mt-3" data-tone={online ? 'ok' : 'error'} role="status"><i />{online ? 'Conectado' : 'Sin conexión. Reconectando.'}</span>
        {notice && <p className="notice mt-3" role="status">{notice}</p>}

        {held && draft ? (
          <div className="card mt-4 grid gap-3">
            <h2 className="type-heading">Trabajando en {held.sheetId}</h2>
            {current && <p className="type-body-sm text-secondary">Mesa {formatInt(current.table)} · puesto {formatInt(current.station)} · municipio {formatInt(current.municipality)}</p>}
            <p className="type-body-sm text-secondary">Tu bloqueo se renueva solo mientras trabajas. Si dejas de usar la página 5 minutos, el acta vuelve a la cola.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {VOTE_KEYS.map((k) => (
                <label key={k} className="grid gap-1">
                  <span className="type-heading">{CANDIDATE_LABEL[k]}</span>
                  <input className="field" inputMode="numeric" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </label>
              ))}
            </div>
            <label className="grid gap-1">
              <span className="type-heading">Sufragantes</span>
              <input className="field" inputMode="numeric" value={voters} onChange={(e) => setVoters(Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </label>
            {!balances(draft, voters) && <p className="notice">Aún no cuadra. Ajusta los totales o los sufragantes.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className="btn-primary" disabled={!balances(draft, voters)} onClick={() => resolve(draft, voters)}>Resolver acta</button>
              <button type="button" className="btn-quiet w-full" onClick={release}>Devolver a la cola</button>
            </div>
          </div>
        ) : (
          <ol className="mt-4 grid gap-2">
            {queue.length === 0 && <li className="type-body-sm text-secondary">No hay actas por verificar. Cuando entre una dudosa aparecerá aquí.</li>}
            {queue.map((q) => (
              <li key={q.sheetId} className="chip flex items-center justify-between gap-3" data-state={q.lockedBy ? 'confirmed' : 'pending'}>
                <div>
                  <p className="type-heading">{q.sheetId}</p>
                  <p className="type-body-sm text-secondary">Mesa {formatInt(q.table)} · puesto {formatInt(q.station)} · municipio {formatInt(q.municipality)}</p>
                  <p className="type-body-sm text-secondary">Diferencia de {formatInt(q.priority)} · versión {q.version}</p>
                  {q.lockedBy && <p className="type-label">La tiene {q.lockedBy}</p>}
                </div>
                <button type="button" className="btn-quiet shrink-0" disabled={!!q.lockedBy} onClick={() => take(q.sheetId)}>Tomar</button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="type-title">Quién está conectado</h2>
        <ul className="mt-3 grid gap-2">
          {presence.length === 0 && <li className="type-body-sm text-secondary">Nadie conectado todavía.</li>}
          {presence.map((p) => (
            <li key={p.auditorId} className="card p-3!">
              <p className="type-heading">{p.auditorId}</p>
              <p className="type-body-sm text-secondary">
                {p.workingOn ? `Trabaja en ${p.workingOn} desde hace ${formatElapsed(now + skew - (p.workingSince ?? now))}` : 'Disponible'}
                {' · '}servidor {p.instanceId}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
