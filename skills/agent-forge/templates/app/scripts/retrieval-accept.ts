/** Opt-in semantic retrieval smoke; synthetic fixtures, not a user-approved evaluation set. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { db, pool } from '../src/db/client';
import { embeddingBudget } from '../src/memory/embedding-budget';
import { embeddingProfile } from '../src/memory/embedding-provider';
import { retrieve } from '../src/memory/retrieve';

const cases = [
  { query: 'How long until my parcel gets here?', expected: 'delivery.md' },
  { query: 'When should the shipment arrive?', expected: 'delivery.md' },
  { query: 'Can I send an unworn purchase back?', expected: 'returns.md' },
  { query: 'What is the deadline to give an item back?', expected: 'returns.md' },
  { query: 'How long is a manufacturing fault covered?', expected: 'warranty.md' },
  { query: 'What protection comes with a defective product?', expected: 'warranty.md' },
  { query: 'What is the orbital period of Neptune?', expected: null },
];
let costUsd = 0;
const budget = embeddingBudget({
  limit: Number(process.env.AF_EMBEDDING_ACCEPT_BUDGET_USD ?? 0),
  current: () => costUsd,
  set: (v) => {
    costUsd = v;
  },
  persist: async () => {},
});
try {
  const profile = embeddingProfile();
  if (!profile.startsWith('openai:'))
    throw new Error(
      'Semantic acceptance requires an explicitly selected OpenAI embedding model, not the hash fixture',
    );
  const results = [];
  for (const item of cases) {
    const hits = await retrieve(db, item.query, 5, 20, undefined, budget);
    const top = hits[0]?.source ?? null;
    results.push({ ...item, actual: top, pass: top === item.expected });
  }
  const report = {
    profile,
    kind: 'live-semantic-synthetic-smoke',
    at: new Date().toISOString(),
    costUsd,
    results,
    ok: results.every((r) => r.pass),
  };
  mkdirSync('.agent-forge', { recursive: true });
  writeFileSync('.agent-forge/retrieval-checks.json', `${JSON.stringify(report, null, 2)}\n`);
  console.table(results);
  console.log(
    JSON.stringify({ costUsd, passed: results.filter((r) => r.pass).length, total: results.length }),
  );
  if (!report.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
