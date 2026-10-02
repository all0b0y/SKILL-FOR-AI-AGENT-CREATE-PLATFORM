'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { Reference } from '@/reference';
import { Answer } from './answer';
import { ApprovalCard } from './approval-card';
import { CostMeter } from './cost-meter';
import { StatusDot } from './status-dot';
import { ToolCard } from './tool-card';
import { type StreamView, useRun } from './use-run';

type Turn = { runId: string; question: string };
type Submission = { text: string; conversationId: string | undefined; idempotencyKey: string };

const SUGGESTIONS = ['How long does delivery take?', 'How do I return an item?', 'My order arrived damaged'];

/** Chat surface: each user turn starts one durable run whose events render below it. */
export function Chat({
  initialTurns = [],
  initialConversationId,
  reference = 'support',
}: {
  reference?: Reference;
  initialTurns?: Turn[];
  initialConversationId?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const reducedMotion = useReducedMotion();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const current = turns.at(-1)?.runId ?? null;
  const live = useRun(current, epoch);
  const busy = sending || (current !== null && (live.status === 'queued' || live.status === 'running'));

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on new content to keep the newest turn in view
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reducedMotion ? 'instant' : 'smooth' });
  }, [live.lastSeq, turns.length, reducedMotion]);

  const send = async (text: string, retry = false) => {
    if (!text.trim() || inFlight.current || busy || live.status === 'awaiting_approval') return;
    if (pending && !retry) return;
    // A lost acknowledgement is not a failed transaction. Keep the exact body and key
    // until it is confirmed; never retry an uncertain POST as a new user turn.
    const submission = pending ?? { text, conversationId, idempotencyKey: crypto.randomUUID() };
    inFlight.current = true;
    setPending(submission);
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submission),
      });
      // A refusal of the first attempt permits editing. A later refusal cannot prove
      // that an earlier, unacknowledged attempt did not commit (nor can a proxy timeout).
      if (!pending && [400, 401, 403, 404, 409, 422].includes(res.status)) setPending(null);
      const data = (await res.json()) as { runId?: string; conversationId?: string; error?: string };
      if (!res.ok || !data.runId || !data.conversationId)
        throw new Error(data.error ?? 'Could not confirm delivery. Retry the same message safely.');
      setConversationId(data.conversationId);
      window.history.replaceState(
        null,
        '',
        `/?conversation=${encodeURIComponent(data.conversationId ?? '')}`,
      );
      setTurns((t) => [...t, { runId: data.runId as string, question: submission.text }]);
      setPending(null);
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the message.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const decide = async (approvalId: string, approved: boolean, reason?: string) => {
    if (!current) return;
    try {
      const res = await fetch(`/api/runs/${current}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId, approved, reason }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Decision failed');
    } finally {
      // Even a lost response may follow a committed decision. Re-read the event log;
      // never imply that an acknowledged side effect can be reversed by clicking Reject.
      setEpoch((e) => e + 1);
    }
  };

  const stop = async () => {
    if (!current) return;
    try {
      const response = await fetch(`/api/runs/${current}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not stop the run.');
    } catch {
      setError('The stop response was not confirmed. Check the saved run status above.');
    } finally {
      setEpoch((e) => e + 1);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <div className="flex flex-1 flex-col">
      {turns.length > 0 && (
        <h1 className="sr-only">
          {reference === 'support' ? 'Support conversation' : 'Evidence conversation'}
        </h1>
      )}
      <div className="flex-1 space-y-6 py-6" aria-live="polite">
        {turns.length === 0 && (
          <Empty reference={reference} disabled={busy || pending !== null} onPick={(s) => void send(s)} />
        )}
        {turns.map((t, i) => (
          <TurnView key={t.runId} turn={t} view={i === turns.length - 1 ? live : null} onDecide={decide} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-0 bg-bg pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {error && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
        )}
        {pending && !sending && (
          <div className="mb-2 text-sm">
            <p className="text-muted">
              Delivery is unconfirmed. Retry will not create a second run. Keep this page open; if you already
              reloaded, check Runs before resending.
            </p>
            <button
              type="button"
              onClick={() => void send(pending.text, true)}
              className="min-h-11 underline underline-offset-4"
            >
              Retry sending
            </button>
          </div>
        )}
        <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-x-2">
          <CostMeter usage={current ? live.usage : null} />
          {current && (busy || live.status === 'awaiting_approval') && (
            <button
              type="button"
              onClick={stop}
              className="min-h-11 text-sm text-muted underline-offset-4 hover:underline"
            >
              Stop
            </button>
          )}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <input
            id="message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              live.status === 'awaiting_approval'
                ? 'Approve or reject the action above first'
                : reference === 'support'
                  ? 'Ask about your order…'
                  : 'Ask about the configured sources…'
            }
            disabled={pending !== null || live.status === 'awaiting_approval'}
            maxLength={4000}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 placeholder:text-muted disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || pending !== null || !input.trim() || live.status === 'awaiting_approval'}
            className="min-h-11 rounded-[var(--radius-control)] bg-accent px-4 font-medium text-accent-fg transition-opacity duration-[var(--duration-feedback)] disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function Empty({
  onPick,
  reference,
  disabled,
}: {
  onPick: (s: string) => void;
  reference: Reference;
  disabled: boolean;
}) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold">How can I help?</h1>
      <p className="mt-1 text-sm text-muted">
        {reference === 'support'
          ? "I answer from the store's knowledge base and can open a ticket for you — you approve it first."
          : reference === 'researcher'
            ? 'Compare configured sources with citations. Read-only: no tickets, saved preferences or web browsing.'
            : 'Review scheduled evidence digests in Runs, or request one here. No external delivery or write actions.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {(reference === 'support'
          ? SUGGESTIONS
          : ['Compare delivery and returns', 'What do the sources say about warranty?']
        ).map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="min-h-11 rounded-full border border-line px-4 text-sm transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2 disabled:opacity-60"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  view,
  onDecide,
}: {
  turn: Turn;
  view: StreamView | null;
  onDecide: (approvalId: string, approved: boolean, reason?: string) => Promise<void>;
}) {
  const reduce = useReducedMotion();
  const archived = useRun(view === null ? turn.runId : null);
  return (
    <motion.article
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-3"
      data-testid="turn"
    >
      <div className="ml-auto w-fit max-w-[85%] rounded-[var(--radius-card)] bg-surface-2 px-4 py-2 break-words">
        {turn.question}
      </div>
      <RunBody view={view ?? archived} onDecide={onDecide} />
    </motion.article>
  );
}

function RunBody({
  view,
  onDecide,
}: {
  view: StreamView;
  onDecide: (id: string, ok: boolean, reason?: string) => Promise<void>;
}) {
  const thinking = (view.status === 'queued' || view.status === 'running') && view.blocks.length === 0;
  return (
    <div className="space-y-3" data-testid="assistant">
      {(view.connection === 'reconnecting' || view.connection === 'disconnected') && (
        <p role="status" className="text-sm text-muted">
          {view.connection === 'reconnecting'
            ? 'Connection interrupted. Reconnecting… Your run continues on the server.'
            : 'Connection closed. Reload this page to reconnect to your saved run.'}
        </p>
      )}
      {thinking && (
        <div className="flex items-center gap-2 text-sm text-muted" role="status">
          <StatusDot status="running" /> Thinking…
        </div>
      )}
      <AnimatePresence initial={false}>
        {view.blocks.map((b) => {
          if (b.kind === 'text') return <Answer key={`t${b.id}`} text={b.text} />;
          const tool = view.tools[b.toolCallId];
          if (!tool) return null;
          return tool.status === 'awaiting_approval' && tool.approvalId ? (
            <ApprovalCard
              key={b.toolCallId}
              tool={tool}
              onDecide={(ok, reason) => onDecide(tool.approvalId as string, ok, reason)}
            />
          ) : (
            <ToolCard key={b.toolCallId} tool={tool} />
          );
        })}
      </AnimatePresence>
      {view.status === 'failed' && (
        <p role="alert" className="text-sm text-danger">
          {view.error ?? 'The assistant stopped with an error.'} Send your message again, or ask for a human.
        </p>
      )}
      {view.status === 'cancelled' && (
        <p className="text-sm text-muted">
          Stopped. No new actions will start; actions already in progress may still finish.
        </p>
      )}
    </div>
  );
}
