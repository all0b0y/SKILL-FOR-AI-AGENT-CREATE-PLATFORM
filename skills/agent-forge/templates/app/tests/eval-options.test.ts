import { expect, test, vi } from 'vitest';
import { repeatCount, requirePaidConsent } from '@/evals/options';

test('zero, negative, NaN and excessive repetitions cannot make vacuous green evals', () => {
  for (const value of ['0', '-1', 'NaN', '2.5', '21', 'Infinity', ''])
    expect(() => repeatCount(value)).toThrow();
  expect(repeatCount('3')).toBe(3);
  expect(repeatCount(undefined)).toBeUndefined();
});

test('live and recording require explicit paid consent, replay and mock do not', () => {
  vi.stubEnv('AF_ALLOW_PAID_CALLS', '0');
  try {
    expect(() => requirePaidConsent('live', 'anthropic/model')).toThrow(/consent/);
    expect(() => requirePaidConsent('record', 'anthropic/model')).toThrow();
    expect(() => requirePaidConsent('replay', 'anthropic/model')).not.toThrow();
    expect(() => requirePaidConsent('live', 'mock')).not.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
});
