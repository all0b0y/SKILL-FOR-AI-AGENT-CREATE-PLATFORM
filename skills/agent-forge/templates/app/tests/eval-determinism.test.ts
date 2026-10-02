import { describe, expect, test } from 'vitest';
import { evalRunOptions } from '../src/evals/determinism';

describe('eval run inputs', () => {
  test('reproduces date and ticket IDs across independent runs', () => {
    const a = evalRunOptions('damaged-approved', 0);
    const b = evalRunOptions('damaged-approved', 0);
    expect(a.today).toBe('2026-01-01');
    expect(a.ticketId()).toBe(b.ticketId());
    expect(a.ticketId()).toBe(b.ticketId());
  });
  test('isolates cases, repetitions and multiple tickets', () => {
    const a = evalRunOptions('a', 0);
    const ids = [
      a.ticketId(),
      a.ticketId(),
      evalRunOptions('b', 0).ticketId(),
      evalRunOptions('a', 1).ticketId(),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
