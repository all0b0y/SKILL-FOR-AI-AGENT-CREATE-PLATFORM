import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { expect, test } from 'vitest';
import { env } from '@/env';
import { ensureQueue } from '@/runs/queue';

test('an idle worker wakes on enqueue instead of waiting out its polling interval', async () => {
  const name = `test-notify-${randomUUID()}`;
  const queue = new PgBoss({ connectionString: env().DATABASE_URL, useListenNotify: true });
  await queue.start();
  try {
    // Deployments created before notify was enabled must be upgraded, not left polling.
    await queue.createQueue(name);
    await ensureQueue(queue, name);
    const handled = new Promise<number>((resolve) => {
      void queue.work(name, { pollingIntervalSeconds: 30 }, async () => resolve(performance.now()));
    });
    // Let the first (empty) fetch finish so the worker is inside its 30 s delay.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sentAt = performance.now();
    await queue.send(name, {});
    expect((await handled) - sentAt).toBeLessThan(3_000);
  } finally {
    await queue.deleteQueue(name);
    await queue.stop({ graceful: true });
  }
}, 10_000);
