import { cn } from '@/lib/cn';

const COLOR: Record<string, string> = {
  running: 'bg-accent animate-pulse motion-reduce:animate-none',
  queued: 'bg-muted',
  awaiting_approval: 'bg-warn',
  done: 'bg-ok',
  error: 'bg-danger',
  failed: 'bg-danger',
  denied: 'bg-muted',
  cancelled: 'bg-muted',
};

/** Decorative status marker with semantic colors and reduced-motion support; pair it with a readable status label. */
export function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', COLOR[status] ?? 'bg-muted')}
    />
  );
}
