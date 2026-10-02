import type { ModelMessage } from 'ai';
import { expect, test, vi } from 'vitest';
import { compactMessages } from '@/agent/compact';

const history = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  message: {
    role: i % 2 ? 'assistant' : 'user',
    content: `source-${i}: ${'x'.repeat(8000)}`,
  } as ModelMessage,
}));

test('compaction persists bounded summaries without deleting sources or repeating summarized rows', async () => {
  const original = JSON.stringify(history);
  let saved: string | null = null;
  const summarize = vi.fn(
    async (_previous: string, source: string) =>
      `Summary of message IDs: ${JSON.parse(source)
        .map((r: { id: number }) => r.id)
        .join(',')}`,
  );
  const persist = async (summary: string) => {
    saved = summary;
  };
  const memory = await compactMessages(history, null, 24000, summarize, persist);
  expect(memory.messages[0]?.role).toBe('user');
  expect(memory.messages).toHaveLength(1);
  expect(memory.summary).toContain('Summary');
  expect(JSON.stringify(history)).toBe(original);
  const calls = summarize.mock.calls.length;
  await compactMessages(history, saved, 24000, summarize, persist);
  expect(summarize).toHaveBeenCalledTimes(calls);
});

test('short conversations do not invoke a summarizer or write a summary', async () => {
  const summarize = vi.fn(async () => 'unused');
  const persist = vi.fn(async () => {});
  await compactMessages(
    [{ id: 1, message: { role: 'user', content: 'hello' } }],
    null,
    24000,
    summarize,
    persist,
  );
  expect(summarize).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
});

test('empty, oversized and failed summaries never advance the persisted cursor', async () => {
  for (const summary of ['', 'x'.repeat(6001)]) {
    const persist = vi.fn(async () => {});
    await expect(compactMessages(history, null, 24000, async () => summary, persist)).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  }
  await expect(
    compactMessages(
      history,
      null,
      24000,
      async () => {
        throw new Error('model unavailable');
      },
      async () => {},
    ),
  ).rejects.toThrow('model unavailable');
});

test('a source larger than the bounded compaction request fails explicitly', async () => {
  await expect(
    compactMessages(
      [
        { id: 1, message: { role: 'user', content: 'x'.repeat(25000) } },
        { id: 2, message: { role: 'user', content: 'next' } },
      ],
      null,
      24000,
      async () => 'summary',
      async () => {},
    ),
  ).rejects.toThrow(/input limit/);
});
