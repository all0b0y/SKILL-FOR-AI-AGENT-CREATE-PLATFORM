import { headers } from 'next/headers';
import Link from 'next/link';
import { StatusDot } from '@/components/agent/status-dot';
import { db } from '@/db/client';
import { recentRuns } from '@/runs/service';
import { identityOf } from '@/server/http';

/** Resolve caller-scoped run visibility on every request instead of statically caching operator data. */
export const dynamic = 'force-dynamic';

/** Operator console: recent runs with status, steps and cost. */
export default async function RunsPage() {
  const who = identityOf(new Request('http://local', { headers: await headers() }));
  const runs = await recentRuns(db, who);
  return (
    <section className="py-6">
      <h1 className="text-lg font-semibold">Runs</h1>
      {runs.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No runs yet. Start a conversation in Chat; every message becomes a run here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                href={`/runs/${r.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-surface-2"
              >
                <StatusDot status={r.status} />
                <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                <span className="text-muted">{r.status.replace('_', ' ')}</span>
                <span className="text-muted">{r.surface}</span>
                <span className="ml-auto text-muted">
                  {r.steps} steps · ${Number(r.costUsd).toFixed(4)} · {r.createdAt.toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
