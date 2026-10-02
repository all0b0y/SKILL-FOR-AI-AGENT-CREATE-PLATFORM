/**
 * Hybrid retrieval: vector similarity and Postgres full-text, fused with Reciprocal Rank Fusion.
 * Why RRF: the two scores live on different scales; fusing ranks needs no tuning and is robust
 * when one list is empty (e.g. no keyword overlap).
 */
import { inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { chunks } from '@/db/schema';
import { embed } from './embed';
import { type EmbeddingBudget, embeddingProfile } from './embedding-provider';

/** Hydrated document passage with stable source identity and fused rank score; score is not a calibrated relevance probability. */
export type Hit = { id: string; source: string; title: string; body: string; score: number };

/** Standard RRF constant; dampens the dominance of the very first ranks. */
const RRF_K = 60;

/** Cosine distance above which a vector neighbour is noise (tune with the real embedder). */
const MAX_DISTANCE = 0.8;

/**
 * Fuse ranked id lists. score(d) = Σ 1 / (k + rank_i(d)), rank 1-based.
 * O(n log n) for n total entries (one pass to score, one sort). Ties keep first-seen order.
 */
export function rrf(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k = RRF_K,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const [i, id] of list.entries()) scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/**
 * Top `limit` chunks for a query. Two indexed queries (HNSW + GIN), each O(log N)-ish, then
 * O(c log c) fusion over c ≤ 2·candidates rows.
 */
export async function retrieve(
  db: Db,
  query: string,
  limit = 5,
  candidates = 20,
  maxDistance = Number(process.env.AF_RETRIEVAL_MAX_DISTANCE ?? MAX_DISTANCE),
  budget?: EmbeddingBudget,
): Promise<Hit[]> {
  if (!Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > 2)
    throw new Error('AF_RETRIEVAL_MAX_DISTANCE must be greater than 0 and at most 2');
  const profile = embeddingProfile();
  const vector = JSON.stringify(await embed(query, budget));
  const [byVector, byText] = await Promise.all([
    // Inner query keeps the HNSW index (ORDER BY distance LIMIT); the outer filter drops
    // neighbours too far to be relevant, so "nothing matches" stays possible.
    db.execute<{ id: string }>(
      sql`select id from (select id, embedding <=> ${vector}::vector as d from chunks
          where embedding_model = ${profile}
          order by embedding <=> ${vector}::vector limit ${candidates}) n where d < ${maxDistance}`,
    ),
    db.execute<{ id: string }>(
      sql`select id from chunks where embedding_model = ${profile} and search @@ websearch_to_tsquery('simple', ${query})
          order by ts_rank(search, websearch_to_tsquery('simple', ${query})) desc limit ${candidates}`,
    ),
  ]);
  const fused = rrf([byVector.rows.map((r) => r.id), byText.rows.map((r) => r.id)]).slice(0, limit);
  if (fused.length === 0) return [];
  const ids = fused.map((f) => f.id);
  const rows = await db
    .select({ id: chunks.id, source: chunks.source, title: chunks.title, body: chunks.body })
    .from(chunks)
    .where(inArray(chunks.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return fused.flatMap((f) => {
    const row = byId.get(f.id);
    return row ? [{ ...row, score: f.score }] : [];
  });
}
