import { describe, expect, test } from 'vitest';
import { applyEvent, emptyRun } from '@/lib/run-events';

const pending = () =>
  applyEvent(emptyRun(), {
    seq: 1,
    type: 'approval-request',
    data: { toolCallId: 'c', tool: 'ticket_create', approvalId: 'a', input: {} },
  });

describe('terminal run views', () => {
  test.each(['cancelled', 'failed', 'done'])('%s retires unexecuted approvals', (status) => {
    const before = pending();
    const after = applyEvent(before, { seq: 2, type: 'status', data: { status } });
    expect(after.tools.c?.status).toBe('cancelled');
    expect(after.tools.c?.approvalId).toBeUndefined();
    expect(before.tools.c?.status).toBe('awaiting_approval');
  });

  test('completed tools retain their results when a run is cancelled', () => {
    const result = applyEvent(pending(), {
      seq: 2,
      type: 'tool-result',
      data: { toolCallId: 'c', output: { ticketId: 'existing' } },
    });
    const cancelled = applyEvent(result, { seq: 3, type: 'status', data: { status: 'cancelled' } });
    expect(cancelled.tools.c?.status).toBe('done');
    expect(cancelled.tools.c?.output).toEqual({ ticketId: 'existing' });
  });
});
