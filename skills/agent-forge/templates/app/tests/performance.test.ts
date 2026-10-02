import { describe, expect, it } from 'vitest';
import { comparePerformance } from '../scripts/performance';

const baseline = {
  version: 1,
  workload: 'test-v1',
  environment: { cpu: 'test-cpu', node: 'test-node' },
  metrics: { hotPathMs: 10 },
};

describe('performance acceptance', () => {
  it.each([
    { ...baseline, version: 2 },
    { ...baseline, workload: 'another-workload' },
    { ...baseline, environment: { cpu: 'different-cpu', node: 'test-node' } },
    { ...baseline, metrics: {} },
    { ...baseline, metrics: { hotPathMs: NaN } },
    { ...baseline, metrics: { hotPathMs: 0 } },
  ])('rejects incompatible or invalid baselines rather than skipping a regression', (invalid) => {
    expect(() => comparePerformance(baseline, { hotPathMs: 100 }, invalid)).toThrow();
  });

  it('labels an absent baseline as not checked while enforcing the absolute budget', () => {
    expect(comparePerformance(baseline, { hotPathMs: 10 })).toEqual({
      comparison: 'not-checked',
      failures: [],
    });
    expect(comparePerformance(baseline, { hotPathMs: 9 }).failures).toEqual([
      expect.stringContaining('exceeds budget'),
    ]);
  });

  it('rejects growth over 20 percent on a comparable baseline, including below the absolute ceiling', () => {
    const limits = { hotPathMs: 100 };
    expect(comparePerformance({ ...baseline, metrics: { hotPathMs: 12 } }, limits, baseline)).toEqual({
      comparison: 'checked',
      failures: [],
    });
    const result = comparePerformance({ ...baseline, metrics: { hotPathMs: 12.01 } }, limits, baseline);
    expect(result.comparison).toBe('checked');
    expect(result.failures).toEqual([expect.stringContaining('hotPathMs: regression exceeds 20%')]);
  });
});
