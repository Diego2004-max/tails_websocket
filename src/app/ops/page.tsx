'use client';
import { useEffect, useState } from 'react';
import { formatInt } from '@/lib/format';
import { GATEWAY_URL } from '@/lib/gateway';

interface M {
  instanceId: string; uptimeSec: number;
  connections: { public: number; jury: number; audit: number };
  messages: { emitted: number; naive: number; perSec: number };
  eventLoop: { p50: number; p99: number; max: number };
  memory: { rssMb: number; kbPerConnection: number };
  sheetsPerMinute: number; publishLatencyMs: { p50: number; p99: number };
  slowClients: { degraded: number; disconnected: number }; redis: 'ready' | 'down';
}

export default function OpsPage() {
  const [instances, setInstances] = useState<M[] | null>(null);
  const [error, setError] = useState(false);
  const [servedBy, setServedBy] = useState<string>('');

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [c, i] = await Promise.all([fetch(`${GATEWAY_URL}/metrics/cluster`, { cache: 'no-store' }), fetch(`${GATEWAY_URL}/instance`, { cache: 'no-store' })]);
        const body = (await c.json()) as { instances: M[] };
        const inst = (await i.json()) as { instanceId: string };
        if (alive) { setInstances(body.instances); setServedBy(inst.instanceId); setError(false); }
      } catch { if (alive) setError(true); }
    };
    void pull();
    const t = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const sum = (f: (m: M) => number) => (instances ?? []).reduce((a, m) => a + f(m), 0);
  const emitted = sum((m) => m.messages.emitted);
  const naive = sum((m) => m.messages.naive);

  return (
    <div className="grid gap-6">
      <section>
        <h1 className="type-title">Operación</h1>
        <p className="type-body-sm mt-1 text-secondary">Se actualiza cada 2 s. Esta consulta la atendió el servidor {servedBy || '…'}; recarga y cambiará (sin sesiones pegajosas).</p>
        {error && <p className="notice mt-3" role="alert">No llegan las métricas. Revisa la conexión con el gateway.</p>}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Conexiones públicas" value={formatInt(sum((m) => m.connections.public))} />
        <Stat label="Actas por minuto" value={formatInt(sum((m) => m.sheetsPerMinute))} />
        <Stat label="Mensajes emitidos" value={formatInt(emitted)} hint={`Enfoque ingenuo: ${formatInt(naive)}`} />
        <Stat label="Reducción por agregación" value={naive > 0 ? `${(naive / Math.max(1, emitted)).toFixed(1).replace('.', ',')}×` : '—'} />
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left">
          <thead>
            <tr className="type-label text-secondary">
              {['Servidor', 'Públicas', 'Jurados', 'Auditores', 'Msg/s', 'Retraso loop p99 / máx (ms)', 'Memoria/conexión (KB)', 'Latencia pub. p50 / p99 (ms)', 'Lentos', 'Redis'].map((h) => (
                <th key={h} className="pb-2 pr-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(instances ?? []).map((m) => (
              <tr key={m.instanceId} className="type-num-md border-t border-outline">
                <td className="py-2 pr-3 type-heading">{m.instanceId}</td>
                <td className="pr-3">{formatInt(m.connections.public)}</td>
                <td className="pr-3">{formatInt(m.connections.jury)}</td>
                <td className="pr-3">{formatInt(m.connections.audit)}</td>
                <td className="pr-3">{formatInt(m.messages.perSec)}</td>
                <td className="pr-3">{m.eventLoop.p99} / {m.eventLoop.max}</td>
                <td className="pr-3">{formatInt(m.memory.kbPerConnection)}</td>
                <td className="pr-3">{m.publishLatencyMs.p50} / {m.publishLatencyMs.p99}</td>
                <td className="pr-3">{m.slowClients.degraded} / {m.slowClients.disconnected}</td>
                <td className={m.redis === 'ready' ? 'text-ok' : 'text-error'}>{m.redis === 'ready' ? '✓ activo' : '✕ caído'}</td>
              </tr>
            ))}
            {instances === null && <tr><td colSpan={10} className="py-4"><div className="skeleton h-6 w-full" /></td></tr>}
            {instances?.length === 0 && <tr><td colSpan={10} className="py-4 type-body-sm text-secondary">Aún no hay instancias reportando.</td></tr>}
          </tbody>
        </table>
        <p className="type-label mt-3 text-secondary">Lentos: clientes degradados a instantánea / desconectados por no consumir.</p>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <p className="type-label text-secondary">{label}</p>
      <p className="type-num-lg mt-1">{value}</p>
      {hint && <p className="type-label text-secondary">{hint}</p>}
    </div>
  );
}
