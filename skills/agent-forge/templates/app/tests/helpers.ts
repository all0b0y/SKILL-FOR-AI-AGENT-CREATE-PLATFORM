/** Shared integration-test helpers: a real Postgres (docker compose `db`), wiped per test. */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { chunks } from '@/db/schema';
import type { Identity } from '@/identity';
import { hashEmbed } from '@/memory/embed';
import { RUN_QUEUE } from '@/runs/queue';
import { SCHEDULE_QUEUE } from '@/runs/schedule';

export const alice: Identity = { userId: 'alice', roles: ['user'] };
export const bob: Identity = { userId: 'bob', roles: ['user'] };

export async function reset(): Promise<void> {
  if (process.env.AF_ALLOW_TEST_DB_RESET !== '1') {
    throw new Error(
      'Tests truncate database tables. Use a disposable database and set AF_ALLOW_TEST_DB_RESET=1.',
    );
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`truncate conversations, messages, runs, run_events, tool_executions, spans, facts, tickets, chunks restart identity cascade`,
    );
    // Durable jobs reference the rows above; leaving them makes a later worker retry deleted runs
    // ahead of fresh ones. Only this app's queues are purged, and only once pg-boss has installed.
    const installed = await tx.execute(sql`select to_regclass('pgboss.job') is not null as present`);
    if (installed.rows[0]?.present)
      await tx.execute(sql`delete from pgboss.job where name in (${RUN_QUEUE}, ${SCHEDULE_QUEUE})`);
  });
}

export async function seedKb(): Promise<void> {
  const docs = [
    ['delivery.md', 'Delivery', 'Delivery takes 2–4 business days in major cities.'],
    ['returns.md', 'Returns', 'You can return any unworn item within 30 days of delivery.'],
  ] as const;
  for (const [source, title, body] of docs) {
    await db.insert(chunks).values({ source, title, body, embedding: hashEmbed(`${title}\n${body}`) });
  }
}

/** Count SQL statements issued while `fn` runs (N+1 detector). */
export async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const { pool } = await import('@/db/client');
  const original = pool.query.bind(pool);
  let queries = 0;
  // biome-ignore lint/suspicious/noExplicitAny: pg's overloaded signature
  (pool as any).query = (...args: any[]) => {
    queries += 1;
    return (original as (...a: unknown[]) => unknown)(...args);
  };
  try {
    return { result: await fn(), queries };
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: restore
    (pool as any).query = original;
  }
}
