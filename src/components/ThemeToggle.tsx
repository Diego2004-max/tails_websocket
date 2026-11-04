'use client';
import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const MODES: { id: Mode; label: string }[] = [
  { id: 'system', label: 'Sistema' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
];

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === 'light') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="theme-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 10 4 4 8-8" />
    </svg>
  );
}

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
    <details className="theme-menu">
      <summary className="theme-trigger" aria-label={`Apariencia: ${MODES.find((item) => item.id === mode)?.label}`} title="Cambiar apariencia">
        <ModeIcon mode={mode} />
        <span className="theme-trigger-label">{MODES.find((item) => item.id === mode)?.label}</span>
        <svg className="theme-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </summary>
      <div className="theme-popover" role="group" aria-label="Preferencia de apariencia">
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="theme-option"
            aria-pressed={mode === id}
            onClick={(event) => {
              apply(id);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}
          >
            <ModeIcon mode={id} />
            <span>{label}</span>
            {mode === id && <CheckIcon />}
          </button>
        ))}
      </div>
    </details>
  );
}
