/** Load ./kb/*.md, replacing each source atomically only after all its embeddings succeed. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { chunks } from '../src/db/schema';
import { embed } from '../src/memory/embed';
import { embeddingBudget } from '../src/memory/embedding-budget';
import { embeddingProfile } from '../src/memory/embedding-provider';

const dir = join(process.cwd(), 'kb');
let total = 0;
let costUsd = 0;
const budget = embeddingBudget({
  limit: Number(process.env.AF_EMBEDDING_INGEST_BUDGET_USD ?? 0),
  current: () => costUsd,
  set: (usd) => {
    costUsd = usd;
  },
  persist: async () => {},
});
try {
  const profile = embeddingProfile();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const text = readFileSync(join(dir, file), 'utf8');
    const title = text.match(/^#\s+(.+)$/m)?.[1] ?? file;
    const paragraphs = text
      .replace(/^#.*$/m, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20);
    const rows: Array<typeof chunks.$inferInsert> = [];
    // No remote calls while holding a transaction. A failed source retains its old index.
    for (const body of paragraphs)
      rows.push({
        source: file,
        title,
        body,
        embeddingModel: profile,
        embedding: await embed(`${title}\n${body}`, budget),
      });
    await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.source, file));
      if (rows.length) await tx.insert(chunks).values(rows);
    });
    total += rows.length;
  }
  console.log(JSON.stringify({ chunks: total, embeddingProfile: profile, costUsd }));
} finally {
  await pool.end();
}
