'use client';
import { useEffect, useState } from 'react';
import { usesGateway } from '@/lib/gateway';

export function DemoBanner() {
  const [shared, setShared] = useState<boolean | null>(null);
  useEffect(() => {
    if (usesGateway) return;
    fetch('/api/demo/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((body: { backend?: string }) => setShared(body.backend === 'redis'))
      .catch(() => setShared(false));
  }, []);
  if (usesGateway) return null;
  return (
    <div className="notice mb-5" role="status">
      <strong>Simulación en este proceso.</strong>{' '}
      {shared === null && 'Comprobando el almacén compartido…'}
      {shared === true && 'El preconteo está en Redis y lo ven todas las visitas de este deploy. La página lo refresca cada 2 s.'}
      {shared === false && 'Sin Redis compartido: lo que transmites solo vive en esta instancia. En Vercel añade UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN.'}
    </div>
  );
}