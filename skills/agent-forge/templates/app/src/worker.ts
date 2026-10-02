/**
 * Worker process: executes queued runs. Run several for throughput; pg-boss row locking
 * guarantees one worker per job. SIGTERM stops taking jobs and waits for in-flight runs.
 */
import { executeRun } from './agent/run';
import { db, pool } from './db/client';
import { boss, enqueueRun, ensureQueue, RUN_QUEUE } from './runs/queue';
import { dispatchScheduled, SCHEDULE_QUEUE } from './runs/schedule';

const instance = await boss();
await ensureQueue(instance, SCHEDULE_QUEUE);
await instance.work(SCHEDULE_QUEUE, async (jobs) => {
  for (const job of jobs) await dispatchScheduled(db, enqueueRun, job.id, job.data);
});
await instance.work<{ runId: string }>(RUN_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const outcome = await executeRun(db, job.data.runId);
    console.log(JSON.stringify({ msg: 'run finished', runId: job.data.runId, outcome }));
  }
});
console.log(JSON.stringify({ msg: 'worker ready', queue: RUN_QUEUE }));

const shutdown = async () => {
  await instance.stop({ graceful: true, timeout: 55_000 });
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
