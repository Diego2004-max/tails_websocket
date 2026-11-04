'use client';
import { IS_VERCEL_DEMO } from '@/lib/mode';

export function DemoBanner() {
  if (!IS_VERCEL_DEMO) return null;
  return (
    <div className="notice mx-auto mb-4 max-w-6xl px-4 sm:px-6" role="status">
      <strong>Modo demo Vercel.</strong> Sin gateway externo: resultados por polling HTTP cada 2 s, jurado y auditoría por POST.
      Los datos viven en memoria del servidor (se reinician en cold start). Para la sustentación completa (8 instancias, SSE, RT-8) usa Docker + gateway.
    </div>
  );
}
