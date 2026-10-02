import assert from 'node:assert/strict';
import type { Tool } from 'ai';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';
import { createRegistry, userFacts } from '@/agent/tools/registry';
import { db } from '@/db/client';
import { facts } from '@/db/schema';
import { reset } from './helpers';

beforeEach(reset);

async function forget(factId: string, fact: string, userId = 'alice') {
  const entry = createRegistry(db).find((t) => t.spec.name === 'forget');
  assert(entry, 'registry must expose approved fact removal');
  expect(entry.spec.input.safeParse({ factId: 'invalid', fact: '' }).success).toBe(false);
  expect(entry?.spec.risk).toBe('destructive');
  expect(entry?.spec.retries).toBe(0);
  const tool: Tool = entry.build({
    userId,
    runId: '00000000-0000-0000-0000-000000000001',
    recall: async () => undefined,
    remember: async () => {},
    span: (_name, fn) => fn(),
  });
  return tool.execute?.({ factId, fact } as never, {
    toolCallId: 'forget',
    messages: [],
    context: {} as never,
  });
}

test('fact context exposes its stable identifier, timestamp and source without inventing provenance', async () => {
  const [row] = await db
    .insert(facts)
    .values({ userId: 'alice', fact: 'Prefers pickup', source: 'run:call' })
    .returning();
  assert(row);
  expect((await userFacts(db, 'alice')).map((s) => JSON.parse(s))).toEqual([
    {
      factId: row.id,
      fact: row.fact,
      source: row.source,
      recordedAt: row.createdAt.toISOString(),
    },
  ]);
  expect(await userFacts(db, 'bob')).toEqual([]);
});

test('deletion checks owner and exact preview, removes only that row, and can safely repeat', async () => {
  const [a, b] = await db
    .insert(facts)
    .values([
      { userId: 'alice', fact: 'Prefers pickup', source: 'r:a' },
      { userId: 'bob', fact: 'Prefers pickup', source: 'r:b' },
    ])
    .returning();
  assert(a && b);
  expect(await forget(b.id, b.fact)).toMatchObject({ removed: false });
  expect(await forget(a.id, 'Wrong preview')).toMatchObject({ removed: false });
  expect(await db.select().from(facts)).toHaveLength(2);
  expect(await forget(a.id, a.fact)).toMatchObject({ removed: true });
  expect(await forget(a.id, a.fact)).toMatchObject({ removed: false });
  expect(await db.select().from(facts).where(eq(facts.userId, 'bob'))).toHaveLength(1);
  expect(await userFacts(db, 'alice')).toEqual([]);
});
