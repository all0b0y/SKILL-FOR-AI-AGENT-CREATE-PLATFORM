'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { ToolView } from '@/lib/run-events';
import { StatusDot } from './status-dot';

const LABEL: Record<ToolView['status'], string> = {
  running: 'Running',
  awaiting_approval: 'Needs approval',
  done: 'Done',
  error: 'Failed',
  denied: 'Rejected',
  cancelled: 'Not executed',
};

/** One collapsible card per tool call: name, status, arguments, result (UI-02). */
export function ToolCard({ tool }: { tool: ToolView }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const summary = summarize(tool);
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
      >
        <StatusDot status={tool.status} />
        <span className="font-mono text-xs">{tool.tool}</span>
        <span className="text-muted">· {LABEL[tool.status]}</span>
        {summary && <span className="ml-auto truncate text-muted">{summary}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-line px-3 py-2">
              <Block label="Arguments" value={tool.input} />
              {tool.output !== undefined && (
                <Block label="Result" value={tool.output} danger={tool.status === 'error'} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Block({ label, value, danger }: { label: string; value: unknown; danger?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{label}</div>
      <pre
        className={cn(
          'max-h-48 overflow-auto rounded-[var(--radius-control)] bg-surface-2 p-2 font-mono text-xs whitespace-pre-wrap',
          danger && 'text-danger',
        )}
      >
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function summarize(tool: ToolView): string {
  const o = tool.output as Record<string, unknown> | string | undefined;
  if (tool.status === 'error' && o && typeof o === 'object' && 'error' in o) {
    return String((o.error as { message?: string }).message ?? 'failed');
  }
  if (o && typeof o === 'object' && 'ticketId' in o) return `ticket ${String(o.ticketId).slice(0, 8)}`;
  if (typeof o === 'string') return `${o.split('\n').length} lines`;
  return '';
}
