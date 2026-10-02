'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useId, useState } from 'react';
import type { ToolView } from '@/lib/run-events';

/**
 * Blocks the run until a human decides (UI-03). Shows exactly what will happen before
 * confirming; Reject asks for an optional reason that goes back to the agent.
 */
export function ApprovalCard({
  tool,
  onDecide,
}: {
  tool: ToolView;
  onDecide: (approved: boolean, reason?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const reasonId = useId();

  const decide = async (approved: boolean) => {
    setBusy(approved ? 'approve' : 'reject');
    setError(null);
    try {
      await onDecide(approved, reason.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the decision. Try again.');
      setBusy(null);
    }
  };

  return (
    <motion.section
      role="alertdialog"
      aria-label={`Approve ${tool.tool}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[var(--radius-card)] border border-warn bg-surface p-4 text-sm"
    >
      <h2 className="font-semibold">The assistant wants to run {humanName(tool.tool)}</h2>
      <p className="mt-1 text-muted">Nothing happens until you approve. This is what will be sent:</p>
      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[var(--radius-control)] bg-surface-2 p-3">
        {Object.entries((tool.input ?? {}) as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words whitespace-pre-wrap">{String(v)}</dd>
          </div>
        ))}
      </dl>
      <label htmlFor={reasonId} className="mt-3 block text-xs text-muted">
        Note for the assistant (optional)
      </label>
      <input
        id={reasonId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        className="mt-1 min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2"
      />
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide(true)}
          className="min-h-11 rounded-[var(--radius-control)] bg-accent px-4 font-medium text-accent-fg transition-opacity duration-[var(--duration-feedback)] disabled:opacity-60"
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide(false)}
          className="min-h-11 rounded-[var(--radius-control)] border border-line px-4 transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2 disabled:opacity-60"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </motion.section>
  );
}

const humanName = (tool: string) => tool.replace(/_/g, ' ');
