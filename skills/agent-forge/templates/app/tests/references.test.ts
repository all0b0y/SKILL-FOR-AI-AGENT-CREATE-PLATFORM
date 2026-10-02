import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resolveModel } from '@/agent/model';
import { executeRun } from '@/agent/run';
import { db } from '@/db/client';
import { facts, runs, tickets } from '@/db/schema';
import { dispatchScheduled } from '@/runs/schedule';
import { conversationMessages, eventsSince, startRun } from '@/runs/service';
import { alice, reset, seedKb } from './helpers';

beforeEach(async () => {
  await reset();
  await seedKb();
  vi.stubEnv('AF_MODEL', 'mock');
  vi.stubEnv('AF_EMBEDDING_MODEL', 'hash');
});
afterEach(() => vi.unstubAllEnvs());
const enqueue = async () => {};

for (const reference of ['researcher', 'background'] as const) {
  for (const c of [
    { input: 'Compare delivery and returns', includes: ['[delivery.md]', '[returns.md]'] },
    { input: 'Delivery duration', includes: ['[delivery.md]'] },
    { input: 'Returns within 30 days', includes: ['[returns.md]'] },
    { input: 'zxqv extraterrestrial kryptonite', includes: ['No reliable sources'] },
  ]) {
    test(`${reference}: ${c.input}`, async () => {
      await db
        .insert(facts)
        .values({ userId: alice.userId, fact: 'PROFILE_SCOPED_FACT_FIXTURE', source: 'fixture' });
      const item = await startRun(db, enqueue, alice, {
        reference,
        text: c.input,
        idempotencyKey: c.input,
        surface: reference === 'background' ? 'cron' : 'chat',
      });
      const model = resolveModel('mock', reference);
      expect(
        await executeRun(db, item.runId, {
          model: {
            ...model,
            doStream: async (options) => {
              expect(options.tools?.map((tool) => tool.name)).toEqual(['kb_search']);
              expect(JSON.stringify(options.prompt)).not.toContain('PROFILE_SCOPED_FACT_FIXTURE');
              return model.doStream(options);
            },
          },
        }),
      ).toBe('done');
      const { events } = await eventsSince(db, alice, item.runId, 0);
      const text = events
        .filter((e) => e.type === 'text')
        .map((e) => (e.data as { text: string }).text)
        .join('');
      for (const expected of c.includes) expect(text).toContain(expected);
      expect(await db.select().from(tickets)).toHaveLength(0);
      expect(await db.select().from(facts)).toHaveLength(1);
      expect(await conversationMessages(db, alice, item.conversationId)).not.toHaveLength(0);
    });
  }
}

test('background occurrence persists its reference across worker configuration changes; redelivery is idempotent', async () => {
  const payload = {
    name: 'policy-digest',
    userId: alice.userId,
    text: 'Compare delivery and returns',
    reference: 'background',
  };
  const first = await dispatchScheduled(db, enqueue, 'occurrence-one', payload);
  const duplicate = await dispatchScheduled(db, enqueue, 'occurrence-one', payload);
  expect(duplicate.runId).toBe(first.runId);
  vi.stubEnv('AF_REFERENCE', 'support');
  expect(await executeRun(db, first.runId)).toBe('done');
  const [row] = await db.select().from(runs).where(eq(runs.id, first.runId));
  assert(row);
  expect(row.reference).toBe('background');
  expect(row.surface).toBe('cron');
  const { events } = await eventsSince(db, alice, first.runId, 0);
  expect(JSON.stringify(events)).toContain('Scheduled evidence digest');
  const next = await dispatchScheduled(db, enqueue, 'occurrence-two', payload);
  expect(next.runId).not.toBe(first.runId);
  await expect(
    startRun(db, enqueue, alice, {
      text: 'continue',
      idempotencyKey: 'switch-profile',
      conversationId: first.conversationId,
    }),
  ).rejects.toThrow('new conversation');
});
