import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { expect, test } from 'vitest';
import { db } from '@/db/client';
import { env } from '@/env';
import { RUN_QUEUE } from '@/runs/queue';
import { reset } from './helpers';

test('destructive reset removes durable jobs as well as their application rows', async () => {
  await reset();
  const queue = new PgBoss(env().DATABASE_URL);
  await queue.start();
  try {
    await queue.createQueue(RUN_QUEUE);
    const id = await queue.send(RUN_QUEUE, { runId: randomUUID() });
    expect(id).not.toBeNull();
    await reset();
    const result = await db.execute(sql`select count(*)::int as count from pgboss.job where id = ${id}`);
    expect(result.rows[0]?.count).toBe(0);
  } finally {
    await queue.stop({ graceful: true });
  }
});
