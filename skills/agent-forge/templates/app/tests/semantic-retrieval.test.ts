import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { executeRun } from '@/agent/run';
import { db } from '@/db/client';
import { chunks, runs } from '@/db/schema';
import { hashEmbed } from '@/memory/embed';
import { embeddingBudget } from '@/memory/embedding-budget';
import { retrieve } from '@/memory/retrieve';
import { startRun } from '@/runs/service';
import { alice, reset } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(reset);

test('SQL retrieval never mixes embedding spaces and runtime persists embedding spend', async () => {
  vi.stubEnv('AF_MODEL', 'mock');
  vi.stubEnv('AF_EMBEDDING_MODEL', 'text-embedding-3-small');
  vi.stubEnv('AF_ALLOW_PAID_EMBEDDINGS', '1');
  vi.stubEnv('OPENAI_API_KEY', 'offline-contract-placeholder');
  vi.stubEnv('AF_EMBEDDING_USD_PER_MILLION', '1');
  const vector = hashEmbed('delivery');
  // Deliberate synthetic vectors: this checks the SQL/ledger contract, NOT semantic quality.
  vi.stubGlobal('fetch', async () =>
    Response.json({
      model: 'text-embedding-3-small',
      data: [{ index: 0, embedding: vector }],
      usage: { total_tokens: 100 },
    }),
  );
  await db.insert(chunks).values([
    { source: 'wrong-space.md', title: 'Delivery', body: 'delivery', embedding: vector },
    {
      source: 'semantic-fixture.md',
      title: 'Policy',
      body: 'Parcel arrives in four days.',
      embedding: vector,
      embeddingModel: 'openai:text-embedding-3-small:256',
    },
  ]);
  let cost = 0;
  const budget = embeddingBudget({
    limit: 1,
    current: () => cost,
    set: (v) => {
      cost = v;
    },
    persist: async () => {},
  });
  expect((await retrieve(db, 'delivery', 5, 20, 0.8, budget)).map((h) => h.source)).toEqual([
    'semantic-fixture.md',
  ]);
  const run = await startRun(db, async () => {}, alice, {
    text: 'delivery',
    idempotencyKey: 'semantic-ledger',
  });
  expect(await executeRun(db, run.runId)).toBe('done');
  const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
  assert(row);
  expect(Number(row.costUsd)).toBeCloseTo(100 / 1_000_000, 6);
});
