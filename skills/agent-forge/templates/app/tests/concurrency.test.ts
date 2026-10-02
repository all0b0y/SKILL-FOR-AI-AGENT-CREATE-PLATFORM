import { eq } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';
import { db } from '@/db/client';
import { conversations, runs } from '@/db/schema';
import { startRun } from '@/runs/service';
import { alice, reset } from './helpers';

beforeEach(reset);

test('concurrent identical deliveries create only one run', async () => {
  const input = { text: 'Delivery question', idempotencyKey: 'concurrent-delivery' };
  const outcomes = await Promise.all(
    Array.from({ length: 4 }, () => startRun(db, async () => {}, alice, input)),
  );
  expect(new Set(outcomes.map((r) => r.runId)).size).toBe(1);
  expect(await db.select().from(runs)).toHaveLength(1);
  expect(await db.select().from(conversations)).toHaveLength(1);
});

test('queue failure rolls back the message, conversation and run', async () => {
  await expect(
    startRun(
      db,
      async () => {
        throw new Error('queue unavailable');
      },
      alice,
      { text: 'Delivery question', idempotencyKey: 'queue-failure' },
    ),
  ).rejects.toThrow('queue unavailable');
  expect(await db.select().from(runs)).toHaveLength(0);
  expect(await db.select().from(conversations)).toHaveLength(0);
});

test('only one active run may append to a conversation', async () => {
  const first = await startRun(db, async () => {}, alice, { text: 'first', idempotencyKey: 'busy-first' });
  await expect(
    startRun(db, async () => {}, alice, {
      text: 'second',
      conversationId: first.conversationId,
      idempotencyKey: 'busy-second',
    }),
  ).rejects.toThrow(/active|pending/);
  await db.update(runs).set({ status: 'done' }).where(eq(runs.id, first.runId));
  await expect(
    startRun(db, async () => {}, alice, {
      text: 'second',
      conversationId: first.conversationId,
      idempotencyKey: 'busy-second',
    }),
  ).resolves.toBeDefined();
});
