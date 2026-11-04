'use client';
import { useEffect, useMemo, useState } from 'react';
import { balances, sumVotes, VOTE_KEYS, type Votes } from '@shared/domain';
import { CANDIDATE_LABEL, formatInt } from '@/lib/format';
import { type OutboxEntry, useJurySocket } from '@/lib/useJurySocket';

const EMPTY: Votes = { C1: 0, C2: 0, C3: 0, BLANK: 0, NULL: 0, UNMARKED: 0 };
const STATE_TEXT: Record<OutboxEntry['state'], string> = {
  queued: 'En cola. Se enviará cuando haya red.',
  sending: 'Enviando…',
  confirmed: 'Registrada.',
  flagged: 'Registrada. Pasó a verificación porque los totales no cuadran.',
  duplicate: 'Ya estaba registrada. No se suma dos veces.',
  stale: 'Ya hay una versión igual o más nueva. No se cambió nada.',
  rejected: 'Rechazada: revisa los datos y envíala de nuevo.',
};
const CONFIRMED = ['confirmed', 'flagged', 'duplicate', 'stale'];

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function JuryPage() {
  const [jurorId, setJurorId] = useState('JUR-0000');
  useEffect(() => {
    const saved = localStorage.getItem('ballot.juror') ?? `JUR-${Math.floor(10000 + Math.random() * 89999)}`;
    localStorage.setItem('ballot.juror', saved);
    setJurorId(saved);
  }, []);

  const { outbox, online, pending, submit } = useJurySocket(jurorId);
  const [table, setTable] = useState('');
  const [votes, setVotes] = useState<Votes>(EMPTY);
  const [voters, setVoters] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const tableNum = Number(table);
  const votersNum = Number(voters);
  const sum = sumVotes(votes);
  const tableOk = Number.isInteger(tableNum) && tableNum >= 1 && tableNum <= 6400;
  const ready = tableOk && voters !== '' && votersNum >= 0;
  const diff = sum - votersNum;
  const known = useMemo(() => outbox.find((e) => e.submission.table === tableNum), [outbox, tableNum]);

  async function onSubmit() {
    const version = submit(tableNum, votes, votersNum, photo ? await sha256(photo) : 'no-photo');
    setMessage(version > 1 ? `Corrección guardada como versión ${version}.` : 'Acta guardada en este dispositivo. Se envía sola.');
    setVotes(EMPTY); setVoters(''); setTable(''); setPhoto(null);
  }

  return (
    <div className="page lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
      <section>
        <h1 className="type-title">Transmitir acta</h1>
        <p className="type-body-sm mt-1 text-secondary">Puedes enviar sin señal: el acta queda en este dispositivo y sale sola cuando vuelva la red.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="pill" data-tone={online ? 'ok' : 'warn'} role="status"><i />{online ? 'Conectado' : 'Sin conexión'}</span>
          <span className="pill"><i />{pending === 0 ? 'Nada pendiente' : `${pending} por enviar`}</span>
        </div>

        <div className="card mt-4 grid gap-4">
          <label className="grid gap-1">
            <span className="type-heading">Número de mesa</span>
            <input className="field" inputMode="numeric" value={table} onChange={(e) => setTable(e.target.value.replace(/\D/g, ''))} placeholder="1 a 6.400" />
            {known && <span className="type-body-sm text-secondary">Esta mesa ya tiene un acta. Se enviará como versión {known.submission.version + 1}.</span>}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {VOTE_KEYS.map((k) => (
              <label key={k} className="grid gap-1">
                <span className="type-heading">{CANDIDATE_LABEL[k]}</span>
                <input className="field" inputMode="numeric" value={votes[k] || ''} placeholder="0"
                  onChange={(e) => setVotes({ ...votes, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
              </label>
            ))}
          </div>

          <label className="grid gap-1">
            <span className="type-heading">Sufragantes</span>
            <input className="field" inputMode="numeric" value={voters} onChange={(e) => setVoters(e.target.value.replace(/\D/g, ''))} placeholder="Total de personas que votaron" />
          </label>

          {voters !== '' && (
            balances(votes, votersNum)
              ? <p className="type-body-sm text-ok">✓ Suma {formatInt(sum)} de {formatInt(votersNum)}. Cuadra.</p>
              : <p className="notice">Los totales suman {formatInt(sum)} y los sufragantes son {formatInt(votersNum)} (diferencia de {formatInt(Math.abs(diff))}). Puedes enviarla: pasará a verificación.</p>
          )}

          <label className="grid gap-1">
            <span className="type-heading">Foto del acta</span>
            <input className="field" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <span className="type-body-sm text-secondary">Se guarda su huella (SHA-256) como respaldo de lo que digitaste.</span>
          </label>

          <button className="btn-primary" disabled={!ready} onClick={onSubmit}>Enviar acta</button>
          {message && <p className="type-body-sm" role="status">{message}</p>}
        </div>
      </section>

      <section>
        <h2 className="type-title">Tus envíos</h2>
        {outbox.length === 0 ? (
          <p className="type-body-sm mt-2 text-secondary">Aún no has enviado actas. Llena el formulario para empezar.</p>
        ) : (
          <ol className="mt-3 grid gap-2">
            {outbox.map((e) => (
              <li key={e.submission.idempotencyKey} className="chip" data-state={CONFIRMED.includes(e.state) ? 'confirmed' : 'pending'}>
                <p className="type-heading">Mesa {formatInt(e.submission.table)} · versión {e.submission.version}</p>
                <p className="type-body-sm">{STATE_TEXT[e.state]}</p>
                {e.attempts > 1 && <p className="type-label text-secondary">{e.attempts} intentos</p>}
              </li>
            ))}
          </ol>
        )}
        <p className="type-label mt-3 text-secondary">Borde punteado: aún sin confirmar. Borde sólido: el servidor ya respondió.</p>
      </section>
    </div>
  );
}
