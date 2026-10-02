import type { ModelMessage } from 'ai';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { closeInterruptedTurns } from '@/agent/history';

const request: ModelMessage = {
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'ticket_create', input: {} }],
};
const followup: ModelMessage = { role: 'user', content: 'Another question' };

test('current unfinished turn stays untouched for approval resumption', () => {
  expect(closeInterruptedTurns([followup, request])).toEqual([followup, request]);
});

test('missing results are unknown, not invented success; source remains intact', () => {
  const input = [request, followup];
  const before = structuredClone(input);
  expect(closeInterruptedTurns(input)).toEqual([
    request,
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c',
          toolName: 'ticket_create',
          output: {
            type: 'error-text',
            value: expect.stringContaining('outcome is unknown'),
          },
        },
      ],
    },
    followup,
  ]);
  expect(input).toEqual(before);
});

test('real recorded results are preserved without duplicate results', () => {
  const result: ModelMessage = {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'c',
        toolName: 'ticket_create',
        output: { type: 'json', value: { ticketId: 't' } },
      },
    ],
  };
  expect(closeInterruptedTurns([request, result, followup])).toEqual([request, result, followup]);
});

test('projection is idempotent across repeated call IDs in different turns', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { maxLength: 50 }), (finished) => {
      const history: ModelMessage[] = finished.flatMap((done) => [
        followup,
        request,
        ...(done
          ? [
              {
                role: 'tool' as const,
                content: [
                  {
                    type: 'tool-result' as const,
                    toolCallId: 'c',
                    toolName: 'ticket_create',
                    output: { type: 'text' as const, value: 'recorded' },
                  },
                ],
              },
            ]
          : []),
      ]);
      history.push(followup);
      const projected = closeInterruptedTurns(history);
      expect(closeInterruptedTurns(projected)).toEqual(projected);
      expect(projected.filter((m) => m.role === 'tool')).toHaveLength(finished.length);
    }),
  );
});
