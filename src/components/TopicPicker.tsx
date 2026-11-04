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
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Nivel" className="control-group">
        {LEVELS.map((l) => (
          <button key={l.id} type="button" className="segment" aria-pressed={level === l.id} onClick={() => { setLevel(l.id); setId(1); emit(l.id, 1); }}>
            {l.label}
          </button>
        ))}
      </div>
      {level !== 'dept' && (
        <label className="flex items-center gap-2">
          <span className="type-label text-secondary">{level === 'mun' ? 'Municipio' : 'Puesto'}</span>
          <input
            className="field !w-24" type="number" inputMode="numeric" min={1} max={max} value={id}
            onChange={(e) => { const n = Math.min(max, Math.max(1, Number(e.target.value) || 1)); setId(n); emit(level, n); }}
          />
          <span className="type-label text-secondary">1–{max}</span>
        </label>
      )}
    </div>
  );
}
