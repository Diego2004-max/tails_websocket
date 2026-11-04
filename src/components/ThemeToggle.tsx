'use client';
import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const LABEL: Record<Mode, string> = { system: 'Sistema', light: 'Día', dark: 'Noche' };

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => {
    const saved = localStorage.getItem('ballot.theme');
    if (saved === 'light' || saved === 'dark') setMode(saved);
  }, []);

  const apply = (next: Mode) => {
    setMode(next);
    if (next === 'system') {
      localStorage.removeItem('ballot.theme');
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem('ballot.theme', next);
      document.documentElement.dataset.theme = next;
    }
  };

  return (
    <div role="group" aria-label="Tema" className="control-group">
      {(Object.keys(LABEL) as Mode[]).map((m) => (
        <button key={m} className="segment" aria-pressed={mode === m} onClick={() => apply(m)}>{LABEL[m]}</button>
      ))}
    </div>
  );
}
