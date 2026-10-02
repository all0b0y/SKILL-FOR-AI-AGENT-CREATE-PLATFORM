/** Incremental, source-preserving working-memory compaction. Original rows are never deleted. */
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import { windowStart } from './window';

const Summary = z.object({
  version: z.literal(1),
  throughId: z.number().int().nonnegative(),
  text: z.string().max(6_000),
});
type Row = { id: number; message: ModelMessage };

/** Incrementally summarize only discarded history after the durable cursor. Persist each validated summary before advancing; retain original rows and return the recent message window. Reject oversized sources, invalid prior summaries and empty model output. */
export async function compactMessages(
  history: Row[],
  previous: string | null,
  budgetChars: number,
  summarize: (previous: string, source: string) => Promise<string>,
  persist: (summary: string) => Promise<void>,
): Promise<{ messages: ModelMessage[]; summary: string }> {
  let state = previous
    ? Summary.parse(JSON.parse(previous))
    : { version: 1 as const, throughId: 0, text: '' };
  const start = windowStart(
    history.map((row) => row.message),
    Math.max(1, budgetChars - 6_000),
  );
  const pending = history.slice(0, start).filter((row) => row.id > state.throughId);
  let offset = 0;
  while (offset < pending.length) {
    const batch: Row[] = [];
    let chars = 0;
    while (offset < pending.length) {
      const row = pending[offset];
      if (!row) break;
      const size = JSON.stringify(row).length;
      if (size > 24_000) throw new Error('A memory source exceeds the compaction input limit');
      if (chars + size > 24_000 && batch.length) break;
      batch.push(row);
      chars += size;
      offset++;
    }
    const text = await summarize(state.text, JSON.stringify(batch));
    if (!text.trim()) throw new Error('Compaction returned an empty summary');
    const last = batch.at(-1);
    if (!last) throw new Error('Compaction batch is empty');
    state = Summary.parse({ version: 1, throughId: last.id, text });
    // Advance the cursor only after the summary is durably saved; interruption is retryable.
    await persist(JSON.stringify(state));
  }
  return { messages: history.slice(start).map((row) => row.message), summary: state.text };
}
