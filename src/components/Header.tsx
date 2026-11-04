'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '/', label: 'Resultados' },
  { href: '/jury', label: 'Jurado' },
  { href: '/audit', label: 'Auditoría' },
  { href: '/ops', label: 'Operación' },
];

/** Wordmark: "tally" with a ballot-box slot (a slotted rectangle with a teal tick = the counted vote). */
function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="9" width="18" height="12" rx="2" />
      <path d="M8 9V6.5A1.5 1.5 0 0 1 9.5 5h5A1.5 1.5 0 0 1 16 6.5V9" />
      <circle cx="12" cy="15" r="2" fill="var(--tertiary)" stroke="none" />
    </svg>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))] sm:px-6">
      <Link href="/" className="flex items-center gap-2 text-primary" aria-label="tally, inicio">
        <Mark />
        <span className="text-xl font-extrabold" style={{ fontVariationSettings: '"wdth" 118' }}>tally</span>
      </Link>
      <ThemeToggle />
      <nav className="flex w-full gap-1 overflow-x-auto" aria-label="Secciones">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="segment inline-flex items-center whitespace-nowrap" data-active={path === l.href} aria-current={path === l.href ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
