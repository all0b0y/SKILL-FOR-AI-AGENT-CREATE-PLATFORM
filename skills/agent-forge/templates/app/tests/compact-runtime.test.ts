import { eq } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';
import { executeRun } from '@/agent/run';
import { db } from '@/db/client';
import { conversations, messages, runs, spans } from '@/db/schema';
import { startRun } from '@/runs/service';
import { alice, reset, seedKb } from './helpers';

beforeEach(reset);

test('long conversation compacts through the model seam, persists its cursor and charges its steps', async () => {
  await seedKb();
  const prior = await startRun(db, async () => {}, alice, {
    text: 'Earlier request',
    idempotencyKey: 'memory-prior',
  });
  await db.update(runs).set({ status: 'done' }).where(eq(runs.id, prior.runId));
  await db.insert(messages).values(
    Array.from({ length: 6 }, (_, i) => ({
      conversationId: prior.conversationId,
      message: {
        role: i % 2 ? 'assistant' : 'user',
        content: `Historical fixture ${i}: ${'x'.repeat(7000)}`,
      },
    })),
  );
  const current = await startRun(db, async () => {}, alice, {
    text: 'How long does delivery take?',
    conversationId: prior.conversationId,
    idempotencyKey: 'memory-current',
  });
  expect(await executeRun(db, current.runId, { modelId: 'mock' })).toBe('done');
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, prior.conversationId));
  const summary = JSON.parse(conversation?.summary ?? '{}');
  expect(summary.throughId).toBeGreaterThan(0);
  expect(summary.text).toContain('Offline source excerpts');
  const original = await db.select().from(messages).where(eq(messages.conversationId, prior.conversationId));
  expect(original.filter((row) => JSON.stringify(row.message).includes('Historical fixture'))).toHaveLength(
    6,
  );
  const traced = await db.select().from(spans).where(eq(spans.runId, current.runId));
  expect(traced.some((row) => row.name === 'memory:compact')).toBe(true);
  const [run] = await db.select().from(runs).where(eq(runs.id, current.runId));
  expect(run?.steps).toBeGreaterThan(2);
});
