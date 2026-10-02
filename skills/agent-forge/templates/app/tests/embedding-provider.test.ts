import { afterEach, expect, test, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/db/schema';
import { type EmbeddingUsage, embeddingProfile, semanticEmbed } from '@/memory/embedding-provider';

afterEach(() => vi.unstubAllEnvs());
function setup() {
  vi.stubEnv('AF_EMBEDDING_MODEL', 'text-embedding-3-small');
  vi.stubEnv('AF_ALLOW_PAID_EMBEDDINGS', '1');
  vi.stubEnv('OPENAI_API_KEY', 'contract-test-placeholder-not-a-credential');
  vi.stubEnv('AF_EMBEDDING_USD_PER_MILLION', '0.02');
  const reserved: number[] = [];
  const settled: EmbeddingUsage[] = [];
  const budget = {
    reserve: async (usd: number) => {
      reserved.push(usd);
      return async (usage: EmbeddingUsage) => {
        settled.push(usage);
      };
    },
  };
  const data = {
    model: 'text-embedding-3-small',
    data: [
      { index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)) },
    ],
    usage: { total_tokens: 7 },
  };
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(data));
  return { budget, data, request, reserved, settled };
}

test('semantic request binds model/dimensions, reserves before network and settles actual usage', async () => {
  const s = setup();
  s.request.mockImplementation(async () => {
    expect(s.reserved).toHaveLength(1);
    return Response.json(s.data);
  });
  expect(await semanticEmbed('contract input', s.budget, s.request)).toEqual(s.data.data[0]?.embedding);
  const [url, options] = s.request.mock.calls[0] ?? [];
  expect(url).toBe('https://api.openai.com/v1/embeddings');
  expect(JSON.parse(String(options?.body))).toEqual({
    model: 'text-embedding-3-small',
    input: 'contract input',
    dimensions: 256,
    encoding_format: 'float',
  });
  expect(options?.redirect).toBe('error');
  expect(s.settled).toEqual([{ inputTokens: 7, costUsd: (7 * 0.02) / 1_000_000 }]);
});

for (const [variable, value] of [
  ['AF_ALLOW_PAID_EMBEDDINGS', '0'],
  ['OPENAI_API_KEY', ''],
  ['AF_EMBEDDING_USD_PER_MILLION', '0'],
  ['AF_EMBEDDING_MODEL', 'unknown'],
] as const) {
  test(`invalid ${variable} prevents all network calls`, async () => {
    const s = setup();
    vi.stubEnv(variable, value);
    await expect(semanticEmbed('input', s.budget, s.request)).rejects.toThrow();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.reserved).toEqual([]);
  });
}
for (const text of ['', 'я'.repeat(4001)]) {
  test(`invalid input bytes (${text.length} chars) are rejected before spending`, async () => {
    const s = setup();
    await expect(semanticEmbed(text, s.budget, s.request)).rejects.toThrow('input');
    expect(s.request).not.toHaveBeenCalled();
  });
}

test('missing/exhausted ledger blocks calls; hash profile does not enter semantic adapter', async () => {
  const s = setup();
  await expect(semanticEmbed('input', undefined, s.request)).rejects.toThrow('ledger');
  await expect(
    semanticEmbed(
      'input',
      {
        reserve: async () => {
          throw new Error('budget');
        },
      },
      s.request,
    ),
  ).rejects.toThrow('budget');
  vi.stubEnv('AF_EMBEDDING_MODEL', 'hash');
  expect(embeddingProfile()).toBe('hash-v1:256');
  await expect(semanticEmbed('input', s.budget, s.request)).rejects.toThrow('not selected');
  expect(s.request).not.toHaveBeenCalled();
});

for (const failure of [
  'status',
  'network',
  'dimensions',
  'model',
  'zero',
  'usage',
  'json',
  'oversized',
  'empty',
] as const) {
  test(`provider ${failure} error has no fallback/retry or body leakage and retains reservation`, async () => {
    const s = setup();
    if (failure === 'dimensions') s.data.data[0]?.embedding.pop();
    if (failure === 'model') s.data.model = 'different-model';
    if (failure === 'zero') s.data.data[0]?.embedding.fill(0);
    if (failure === 'usage') s.data.usage.total_tokens = 9000;
    if (failure === 'status')
      s.request.mockResolvedValue(new Response('PRIVATE_PROVIDER_BODY', { status: 429 }));
    if (failure === 'network') s.request.mockRejectedValue(new Error('PRIVATE_PROVIDER_BODY'));
    if (failure === 'json') s.request.mockResolvedValue(new Response('PRIVATE_PROVIDER_BODY'));
    if (failure === 'oversized') s.request.mockResolvedValue(new Response('x'.repeat(65_000)));
    if (failure === 'empty') s.request.mockResolvedValue(new Response(null));
    await expect(semanticEmbed('input', s.budget, s.request)).rejects.toThrow('no fallback');
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.reserved).toHaveLength(1);
    expect(s.settled).toEqual([]);
  });
}
