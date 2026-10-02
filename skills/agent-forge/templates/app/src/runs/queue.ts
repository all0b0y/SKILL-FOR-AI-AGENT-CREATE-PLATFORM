/**
 * pg-boss queue. Chat, cron and webhooks only enqueue; the worker process executes.
 * `singletonKey` = run id, so a duplicate enqueue of the same run is a no-op.
 * Queues opt into a transactional NOTIFY so an idle worker starts a run as soon as it commits;
 * polling remains the correctness floor when LISTEN is unavailable (e.g. PgBouncer transaction mode).
 */
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { env } from '@/env';
import type { RunTransaction } from './service';

/** Durable execution queue shared by chat, webhook and scheduled runs. */
export const RUN_QUEUE = 'agent-runs';

const globalForBoss = globalThis as unknown as { afBoss?: Promise<PgBoss> };

/** Started pg-boss instance, shared per process, with the LISTEN/NOTIFY wake-up path enabled. */
export function boss(): Promise<PgBoss> {
  globalForBoss.afBoss ??= (async () => {
    const instance = new PgBoss({ connectionString: env().DATABASE_URL, useListenNotify: true });
    instance.on('error', () => console.error(JSON.stringify({ msg: 'queue error', code: 'QUEUE_ERROR' })));
    instance.on('warning', () =>
      console.warn(JSON.stringify({ msg: 'queue warning', code: 'QUEUE_WARNING' })),
    );
    await instance.start();
    await ensureQueue(instance, RUN_QUEUE);
    return instance;
  })();
  return globalForBoss.afBoss;
}

/** Create a notify-enabled queue, upgrading one created before notify was enabled. Idempotent. */
export async function ensureQueue(instance: PgBoss, name: string): Promise<void> {
  await instance.createQueue(name, { notify: true });
  await instance.updateQueue(name, { notify: true });
}

/** Publish a run using the caller transaction and run-ID singleton key. Queue publication commits or rolls back with application state. */
export async function enqueueRun(runId: string, tx: RunTransaction): Promise<void> {
  await (await boss()).send(RUN_QUEUE, { runId }, { singletonKey: runId, db: fromDrizzle(tx, sql) });
}
