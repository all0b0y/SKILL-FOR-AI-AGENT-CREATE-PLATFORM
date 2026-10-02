import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { expect, test } from 'vitest';
import { callKey } from '../src/evals/cassette';

const options = (subject: string): LanguageModelV4CallOptions => ({
  prompt: [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'ticket_create',
          output: { type: 'text', value: JSON.stringify({ ticketId: 'fixed-fixture-id', subject }) },
        },
      ],
    },
  ],
});

test('cassette keys retain business tool results and model identity', () => {
  expect(callKey('mock', options('Damaged'))).toBe(callKey('mock', options('Damaged')));
  expect(callKey('mock', options('Damaged'))).not.toBe(callKey('mock', options('Lost')));
  expect(callKey('mock', options('Damaged'))).not.toBe(callKey('other', options('Damaged')));
});

test('prompt changes invalidate a cassette', () => {
  const a: LanguageModelV4CallOptions = { prompt: [{ role: 'system', content: 'Original' }] };
  const b: LanguageModelV4CallOptions = { prompt: [{ role: 'system', content: 'Changed' }] };
  expect(callKey('mock', a)).not.toBe(callKey('mock', b));
});
