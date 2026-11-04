'use client';
import { useState } from 'react';
import { GEOGRAPHY, type Topic } from '@shared/domain';

type Level = 'dept' | 'mun' | 'pst';
const LEVELS: { id: Level; label: string }[] = [
  { id: 'dept', label: 'Departamento' },
  { id: 'mun', label: 'Municipio' },
  { id: 'pst', label: 'Puesto' },
];

export function TopicPicker({ onChange }: { onChange: (t: Topic) => void }) {
  const [level, setLevel] = useState<Level>('dept');
  const [id, setId] = useState(1);
  const max = level === 'mun' ? GEOGRAPHY.municipalities : GEOGRAPHY.stations;

  const emit = (l: Level, n: number) => onChange(l === 'dept' ? 'dept' : (`${l}:${n}` as Topic));

  return (
    <div className="grid gap-3">
      <div role="group" aria-label="Nivel" className="grid grid-cols-3 gap-2">
        {LEVELS.map((l) => (
          <button key={l.id} className="segment" aria-pressed={level === l.id} onClick={() => { setLevel(l.id); setId(1); emit(l.id, 1); }}>
            {l.label}
          </button>
        ))}
      </div>
      {level !== 'dept' && (
        <label className="grid gap-1">
          <span className="type-heading">{level === 'mun' ? 'Número de municipio' : 'Número de puesto'}</span>
          <input
            className="field" type="number" inputMode="numeric" min={1} max={max} value={id}
            onChange={(e) => { const n = Math.min(max, Math.max(1, Number(e.target.value) || 1)); setId(n); emit(level, n); }}
          />
          <span className="type-body-sm text-secondary">Entre 1 y {max}.</span>
        </label>
      )}
    </div>
  );
}
