'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/', label: 'Chat' },
  { href: '/runs', label: 'Runs' },
] as const;

/** Responsive primary navigation with an active-route label and 44px-high targets. The reference title is supplied by the server layout. */
export function Nav({ title = 'Support assistant' }: { title?: string }) {
  const path = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3">
      <span className="text-sm font-semibold">{title}</span>
      <nav aria-label="Main" className="flex gap-1">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path === l.href ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-muted transition-colors duration-[var(--duration-feedback)] hover:text-fg',
              path === l.href && 'bg-surface-2 text-fg',
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
