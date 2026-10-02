import { headers } from 'next/headers';
import Link from 'next/link';
import { StatusDot } from '@/components/agent/status-dot';
import { db } from '@/db/client';
import { runDetail } from '@/runs/service';
import { identityOf } from '@/server/http';

/** Resolve run identity and trace data on every request, never from a shared static page cache. */
export const dynamic = 'force-dynamic';

/** Run timeline from the trace table: every step and tool call with duration and cost. */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = identityOf(new Request('http://local', { headers: await headers() }));
  const { run, spans } = await runDetail(db, who, id);
  const t0 = spans[0]?.startedAt.getTime() ?? 0;
  return (
    <section className="py-6">
      <h1 className="text-lg font-semibold">
        Run <span className="font-mono text-base">{id.slice(0, 8)}</span>
      </h1>
      <p className="mt-2 text-sm text-muted">Status: {run.status.replaceAll('_', ' ')}</p>
      <Link
        href={`/?conversation=${encodeURIComponent(run.conversationId)}`}
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Open conversation
      </Link>
      <ol className="mt-4 space-y-2" aria-label="Timeline">
        {spans.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-x-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm"
          >
            <StatusDot status={s.status === 'ok' ? 'done' : 'error'} />
            <span className="sr-only">Status: {s.status}</span>
            <span className="font-mono text-xs">{s.name}</span>
            <span className="text-muted">+{s.startedAt.getTime() - t0} ms</span>
            <span className="text-muted">{s.endedAt.getTime() - s.startedAt.getTime()} ms</span>
            {s.costUsd != null && <span className="ml-auto text-muted">${Number(s.costUsd).toFixed(5)}</span>}
          </li>
        ))}
      </ol>
      {spans.length === 0 && (
        <p className="mt-4 text-sm text-muted">No trace yet — the run has not started.</p>
      )}
    </section>
  );
}
