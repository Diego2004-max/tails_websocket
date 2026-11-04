'use client';
import { IS_VERCEL_DEMO } from '@/lib/mode';

export function DemoBanner() {
  if (!IS_VERCEL_DEMO) return null;
  return (
    <div className="notice mb-5" role="status">
      <strong>Modo demo Vercel.</strong> Resultados por polling cada 2 s. Los datos viven en memoria del servidor y se reinician en un cold start.
    </div>
  );
}
