import { expect, test } from 'vitest';
import { embeddingBudget } from '@/memory/embedding-budget';

test('parallel reservations obey the shared ceiling and successful settlement refunds unused cost', async () => {
  let total = 0.9;
  const saved: number[] = [];
  const budget = embeddingBudget({
    limit: 1,
    current: () => total,
    set: (value) => {
      total = value;
    },
    persist: async () => {
      saved.push(total);
    },
  });
  const results = await Promise.allSettled([budget.reserve(0.06), budget.reserve(0.06)]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  const first = results[0];
  if (first?.status !== 'fulfilled') throw new Error('reservation failed');
  await first.value({ inputTokens: 1, costUsd: 0.01 });
  expect(total).toBeCloseTo(0.91);
  expect(saved.at(-1)).toBeCloseTo(0.91);
  await expect(first.value({ inputTokens: 1, costUsd: 0 })).rejects.toThrow('settlement');
});

test('failed persistence cannot authorize a request; unknown billing remains reserved', async () => {
  let total = 0;
  const budget = embeddingBudget({
    limit: 1,
    current: () => total,
    set: (v) => {
      total = v;
    },
    persist: async () => {
      throw new Error('database unavailable');
    },
  });
  await expect(budget.reserve(0.2)).rejects.toThrow('database unavailable');
  expect(total).toBe(0.2);
});
