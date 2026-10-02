import type { ModelMessage } from 'ai';

/**
 * Close interrupted tool exchanges before a later user turn. O(messages + parts).
 * Model-only projection: original messages and receipts remain the source of truth.
 * Missing results are explicitly unknown, never presented as successful or safe to retry.
 * The current turn is untouched so its real approval can still resume normally.
 */
export function closeInterruptedTurns(history: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  let turn: ModelMessage[] = [];
  const close = () => {
    const pending = new Map<string, string>();
    for (const message of turn) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type === 'tool-call') pending.set(part.toolCallId, part.toolName);
        if (part.type === 'tool-result') pending.delete(part.toolCallId);
      }
    }
    // Historical approval markers are control-plane data, not a fresh authorization.
    for (const message of turn) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const content = message.content.filter((p) => p.type !== 'tool-approval-request');
        if (content.length) result.push({ ...message, content });
      } else if (message.role === 'tool') {
        const content = message.content.filter((p) => p.type !== 'tool-approval-response');
        if (content.length) result.push({ ...message, content });
      } else result.push(message);
    }
    if (pending.size) {
      result.push({
        role: 'tool',
        content: [...pending].map(([toolCallId, toolName]) => ({
          type: 'tool-result',
          toolCallId,
          toolName,
          output: {
            type: 'error-text',
            value:
              'The previous turn ended without a recorded tool result. Execution outcome is unknown. Do not assume success or automatically retry this action.',
          },
        })),
      });
    }
    turn = [];
  };
  for (const message of history) {
    if (message.role === 'user') close();
    turn.push(message);
  }
  return [...result, ...turn];
}
