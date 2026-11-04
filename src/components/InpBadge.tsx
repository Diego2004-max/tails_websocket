'use client';
import { useEffect, useState } from 'react';
import { onINP } from 'web-vitals';

/** RT-9: Interaction to Next Paint measured in the real page, under the real load. */
export function InpBadge() {
  const [inp, setInp] = useState<{ value: number; rating: string } | null>(null);
  useEffect(() => {
    onINP((m) => setInp({ value: Math.round(m.value), rating: m.rating }), { reportAllChanges: true });
  }, []);
  const label = inp ? ({ good: 'bueno', 'needs-improvement': 'mejorable', poor: 'lento' } as Record<string, string>)[inp.rating] : null;
  return (
    <p className="type-label text-secondary">
      INP de esta página: {inp ? <span className="type-num-sm">{inp.value} ms ({label})</span> : 'toca la pantalla para medirlo'}
    </p>
  );
}
