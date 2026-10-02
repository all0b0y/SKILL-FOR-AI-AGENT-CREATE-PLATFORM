import { eq } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';
import { executeRun } from '@/agent/run';
import { db } from '@/db/client';
import { runs, tickets } from '@/db/schema';
import { dispatchScheduled, ScheduleDefinition } from '@/runs/schedule';
import { reset, seedKb } from './helpers';

beforeEach(reset);
const payload = { name: 'daily-policy', userId: 'scheduled-user', text: 'How long does delivery take?' };

test('scheduled occurrence is owned, durable, idempotent and executes via the normal runtime', async () => {
  await seedKb();
  const first = await dispatchScheduled(db, async () => {}, 'occurrence-1', payload);
  const duplicate = await dispatchScheduled(db, async () => {}, 'occurrence-1', payload);
  expect(duplicate.runId).toBe(first.runId);
  expect(duplicate.duplicate).toBe(true);
  expect(await executeRun(db, first.runId, { modelId: 'mock' })).toBe('done');
  const [row] = await db.select().from(runs).where(eq(runs.id, first.runId));
  expect(row?.userId).toBe('scheduled-user');
  expect(row?.surface).toBe('cron');
  const next = await dispatchScheduled(db, async () => {}, 'occurrence-2', payload);
  expect(next.runId).not.toBe(first.runId);
});

test('background execution never bypasses human approval for writes', async () => {
  const run = await dispatchScheduled(db, async () => {}, 'needs-approval', {
    ...payload,
    text: 'My order arrived damaged',
  });
  expect(await executeRun(db, run.runId, { modelId: 'mock' })).toBe('awaiting_approval');
  expect(await db.select().from(tickets)).toHaveLength(0);
});

test('malformed schedules fail before persistence', () => {
  expect(
    ScheduleDefinition.safeParse({ ...payload, cron: '0 9 * * *', timezone: 'not/a-zone' }).success,
  ).toBe(false);
  expect(ScheduleDefinition.safeParse({ ...payload, cron: '0 9 * * *' }).success).toBe(true);
});
