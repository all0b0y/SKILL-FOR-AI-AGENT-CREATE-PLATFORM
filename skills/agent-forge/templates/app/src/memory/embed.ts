/**
 * Embedder. The template ships a deterministic feature-hashing embedder so retrieval works
 * offline (tests, evals replay, first run). Explicit OpenAI embedding selection uses the
 * fixed schema width, a paid-call opt-in and a mandatory budget ledger; never falls back.
 */
import { EMBEDDING_DIMENSIONS } from '@/db/schema';
import { type EmbeddingBudget, embeddingProfile, semanticEmbed } from './embedding-provider';

const TOKEN = /[\p{L}\p{N}]+/gu;

/** FNV-1a 32-bit. O(n) in the token length. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Hashing-trick bag of words + character trigrams, L2-normalised.
 * O(n) in text length, fixed memory O(d). Similar wording → high cosine similarity, which is
 * enough for a template and for deterministic tests; it carries no semantics.
 */
export function hashEmbed(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const v = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(TOKEN) ?? [];
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    v[h % dimensions] = (v[h % dimensions] ?? 0) + ((h & 0x80000000) === 0 ? weight : -weight);
  };
  for (const t of tokens) {
    add(`w:${t}`, 1);
    for (let i = 0; i + 3 <= t.length; i++) add(`c:${t.slice(i, i + 3)}`, 0.5);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Dispatch to the explicitly selected hash or semantic embedder. Semantic mode requires its cost ledger and consent; failure never falls back to hash. */
export async function embed(text: string, budget?: EmbeddingBudget): Promise<number[]> {
  return embeddingProfile().startsWith('hash-v1:') ? hashEmbed(text) : semanticEmbed(text, budget);
}
