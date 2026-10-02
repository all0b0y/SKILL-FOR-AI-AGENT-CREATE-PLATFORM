import assert from 'node:assert/strict';
import { beforeEach, expect, test } from 'vitest';
import { executeRun } from '@/agent/run';
import { userFacts } from '@/agent/tools/registry';
import { db } from '@/db/client';
import { facts } from '@/db/schema';
import { conversationMessages, decideApproval, eventsSince, startRun } from '@/runs/service';
import { alice, reset, seedKb } from './helpers';

process.env.AF_MODEL = 'mock';
const enqueue = async () => {};
beforeEach(async () => {
  await reset();
  await seedKb();
});

async function decision(runId: string, approved: boolean) {
  const { events } = await eventsSince(db, alice, runId, 0);
  const request = events.find((event) => event.type === 'approval-request');
  assert(request);
  const { approvalId } = request.data as { approvalId: string };
  await decideApproval(db, enqueue, alice, { runId, approvalId, approved });
  expect(await executeRun(db, runId)).toBe('done');
}

test('remember and forget both require approval; rejection preserves memory and deletion preserves source history', async () => {
  const saved = await startRun(db, enqueue, alice, {
    text: 'Remember: Prefers pickup',
    idempotencyKey: 'remember',
  });
  expect(await executeRun(db, saved.runId)).toBe('awaiting_approval');
  expect(await db.select().from(facts)).toHaveLength(0);
  await decision(saved.runId, true);
  const [fact] = await db.select().from(facts);
  assert(fact);
  expect(fact.fact).toBe('Prefers pickup');
  const source = await conversationMessages(db, alice, saved.conversationId);
  const question = `Forget fact ${fact.id}: ${fact.fact}`;
  const denied = await startRun(db, enqueue, alice, { text: question, idempotencyKey: 'forget-denied' });
  expect(await executeRun(db, denied.runId)).toBe('awaiting_approval');
  expect(await userFacts(db, alice.userId)).toHaveLength(1);
  await decision(denied.runId, false);
  expect(await userFacts(db, alice.userId)).toHaveLength(1);
  const deleted = await startRun(db, enqueue, alice, { text: question, idempotencyKey: 'forget-approved' });
  expect(await executeRun(db, deleted.runId)).toBe('awaiting_approval');
  expect(await userFacts(db, alice.userId)).toHaveLength(1);
  await decision(deleted.runId, true);
  expect(await userFacts(db, alice.userId)).toEqual([]);
  expect(await conversationMessages(db, alice, saved.conversationId)).toEqual(source);
});
