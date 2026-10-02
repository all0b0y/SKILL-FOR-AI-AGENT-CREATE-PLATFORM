/**
 * Working-memory window (context compaction, BU-08). Keeps the newest messages that fit a
 * character budget and always starts at a user message, so a tool result is never separated
 * from the assistant turn that called it.
 */
export type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown };

const size = (m: Msg) =>
  typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;

/**
 * Select the suffix of `messages` to send to the model.
 * O(n) time, O(1) extra space: one backward scan accumulating size, then a forward scan to
 * the next user message. The newest user turn is always kept, even when it alone exceeds
 * the budget, because dropping it would answer a different question.
 * @returns index of the first kept message (0 = nothing dropped)
 */
export function windowStart(messages: ReadonlyArray<Msg>, budgetChars: number): number {
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Msg;
    total += size(m);
    if (total > budgetChars) break;
    start = i;
  }
  while (start < messages.length && (messages[start] as Msg).role !== 'user') start++;
  if (start === messages.length) {
    // Budget smaller than the last turn: fall back to the last user message.
    for (let i = messages.length - 1; i >= 0; i--) if ((messages[i] as Msg).role === 'user') return i;
    return messages.length;
  }
  return start;
}
