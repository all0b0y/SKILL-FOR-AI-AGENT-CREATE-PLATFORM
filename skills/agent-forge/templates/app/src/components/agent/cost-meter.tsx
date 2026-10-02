import type { RunView } from '@/lib/run-events';

/** Live steps and cost against the run's ceilings (UI-05). */
export function CostMeter({ usage }: { usage: RunView['usage'] }) {
  if (!usage) return null;
  const pct = Math.min(100, (usage.costUsd / usage.maxCostUsd) * 100);
  return (
    <output className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Run usage">
      <span>
        Step {usage.steps}/{usage.maxSteps}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full bg-accent transition-[width] duration-[var(--duration-state)]"
            style={{ width: `${pct}%` }}
          />
        </span>
        ${usage.costUsd.toFixed(4)} / ${usage.maxCostUsd.toFixed(2)}
      </span>
    </output>
  );
}
