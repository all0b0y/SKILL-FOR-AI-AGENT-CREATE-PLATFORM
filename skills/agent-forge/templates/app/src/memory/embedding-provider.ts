/** Explicit paid embedding adapter. No fallback, retries, response-body logging or user identifiers. */
import { z } from 'zod';
import { EMBEDDING_DIMENSIONS } from '@/db/schema';

/** Provider-confirmed input token count and billed USD used to settle a reservation. */
export type EmbeddingUsage = { inputTokens: number; costUsd: number };
/** Durable reservation/settlement seam. Reserve before sending; retain the reservation whenever billing is uncertain. */
export type EmbeddingBudget = {
  /** Persist a conservative reservation BEFORE the request. Keep it if billing is unknown. */
  reserve: (usd: number) => Promise<(usage: EmbeddingUsage) => Promise<void>>;
};

/** Return the configured model/version/dimension namespace used to isolate incompatible indexes. Unsupported models throw rather than silently selecting another provider. */
export function embeddingProfile(): string {
  const model = process.env.AF_EMBEDDING_MODEL ?? 'hash';
  if (model === 'hash') return `hash-v1:${EMBEDDING_DIMENSIONS}`;
  if (!['text-embedding-3-small', 'text-embedding-3-large'].includes(model))
    throw new Error('Unsupported AF_EMBEDDING_MODEL');
  return `openai:${model}:${EMBEDDING_DIMENSIONS}`;
}

const responseSchema = z.object({
  model: z.string(),
  data: z
    .array(z.object({ index: z.literal(0), embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS) }))
    .length(1),
  usage: z.object({ total_tokens: z.number().int().min(1).max(8192) }),
});

/** Injectable transport is for contract tests; production always calls the fixed HTTPS endpoint. */
export async function semanticEmbed(
  text: string,
  budget?: EmbeddingBudget,
  request: typeof fetch = fetch,
): Promise<number[]> {
  const profile = embeddingProfile();
  if (!profile.startsWith('openai:')) throw new Error('Semantic embedding model is not selected');
  if (process.env.AF_ALLOW_PAID_EMBEDDINGS !== '1')
    throw new Error('Paid embeddings require AF_ALLOW_PAID_EMBEDDINGS=1');
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > 8000)
    throw new Error('Embedding input must be nonempty and at most 8000 UTF-8 bytes');
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is required for semantic embeddings');
  const price = Number(process.env.AF_EMBEDDING_USD_PER_MILLION);
  if (!Number.isFinite(price) || price <= 0 || price > 100)
    throw new Error('Set a verified positive AF_EMBEDDING_USD_PER_MILLION (at most 100)');
  if (!budget) throw new Error('Semantic embedding requires a cost reservation ledger');
  const model = profile.split(':')[1];
  const settle = await budget.reserve((8192 * price) / 1_000_000);
  try {
    const response = await request('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
    });
    if (!response.ok) throw new Error('provider status');
    // Bound response bytes, not just Content-Length (which may be absent or false).
    if (!response.body) throw new Error('empty response');
    const reader = response.body.getReader();
    const pieces: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64_000) throw new Error('oversized response');
        pieces.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(pieces).toString('utf8')));
    if (!parsed.success || parsed.data.model !== model) throw new Error('invalid response');
    const vector = parsed.data.data[0]?.embedding;
    if (!vector?.some((x) => x !== 0) || !vector.every(Number.isFinite)) throw new Error('invalid vector');
    await settle({
      inputTokens: parsed.data.usage.total_tokens,
      costUsd: (parsed.data.usage.total_tokens * price) / 1_000_000,
    });
    return vector;
  } catch {
    // The request may have been billed. Leave its reservation in place; never retry silently.
    throw new Error('Semantic embedding failed; no fallback used. Cost reservation retained if unsettled.');
  }
}
