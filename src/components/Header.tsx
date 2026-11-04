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

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="9" width="18" height="12" rx="2" />
      <path d="M8 9V6.5A1.5 1.5 0 0 1 9.5 5h5A1.5 1.5 0 0 1 16 6.5V9" />
      <circle cx="12" cy="15" r="2" fill="var(--tertiary)" stroke="none" />
    </svg>
  );
}

function Nav({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <nav className={`control-group ${className ?? ''}`} aria-label="Secciones">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="segment" data-active={path === l.href} aria-current={path === l.href ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-outline bg-neutral/85 backdrop-blur-md">
      <div className="shell flex h-16 items-center gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-primary" aria-label="tally, inicio">
          <Mark />
          <span className="text-lg font-extrabold tracking-tight" style={{ fontVariationSettings: '"wdth" 118' }}>tally</span>
        </Link>
        <Nav className="hidden md:inline-flex" />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
      <div className="shell flex pb-3 md:hidden">
        <Nav className="w-full overflow-x-auto" />
      </div>
    </header>
  );
}
