/**
 * pg-boss queue. Chat, cron and webhooks only enqueue; the worker process executes.
 * `singletonKey` = run id, so a duplicate enqueue of the same run is a no-op.
 */
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { env } from '@/env';
import type { RunTransaction } from './service';

/** Durable execution queue shared by chat, webhook and scheduled runs. */
export const RUN_QUEUE = 'agent-runs';

const globalForBoss = globalThis as unknown as { afBoss?: Promise<PgBoss> };

/** Started pg-boss instance, shared per process. */
export function boss(): Promise<PgBoss> {
  globalForBoss.afBoss ??= (async () => {
    const instance = new PgBoss(env().DATABASE_URL);
    instance.on('error', () => console.error(JSON.stringify({ msg: 'queue error', code: 'QUEUE_ERROR' })));
    await instance.start();
    await instance.createQueue(RUN_QUEUE);
    return instance;
  })();
  return globalForBoss.afBoss;
}

/** Publish a run using the caller transaction and run-ID singleton key. Queue publication commits or rolls back with application state. */
export async function enqueueRun(runId: string, tx: RunTransaction): Promise<void> {
  await (await boss()).send(RUN_QUEUE, { runId }, { singletonKey: runId, db: fromDrizzle(tx, sql) });
}
