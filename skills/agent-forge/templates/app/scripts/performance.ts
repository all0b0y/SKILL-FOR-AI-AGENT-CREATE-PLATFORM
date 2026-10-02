import assert from 'node:assert/strict';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { z } from 'zod';

const Metrics = z
  .record(z.string().min(1), z.number().finite().positive())
  .refine((value) => Object.keys(value).length > 0, 'At least one metric is required');
const Report = z.object({
  version: z.literal(1),
  workload: z.string().min(1),
  environment: z
    .record(z.string().min(1), z.string().min(1))
    .refine((value) => Object.keys(value).length > 0, 'Environment fingerprint is required'),
  metrics: Metrics,
});

/* Runtime facts, not a machine name or credentials. Browser/workload specifics are added by callers. */
export function performanceEnvironment() {
  const processors = cpus();
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
    cpu: [...new Set(processors.map((cpu) => cpu.model))].sort().join(','),
    cpuCount: String(processors.length),
    memoryBytes: String(totalmem()),
  };
}

/**
 * Validate fixed-workload reports, absolute budgets and optional >20% regressions.
 * Incompatible hardware/runtime/workloads throw instead of silently skipping comparison.
 * No baseline returns `not-checked`; accepting or overwriting a baseline is never automatic.
 */
export function comparePerformance(currentInput: unknown, budgetInput: unknown, baselineInput?: unknown) {
  const current = Report.parse(currentInput);
  const budgets = Metrics.parse(budgetInput);
  const baseline = baselineInput === undefined ? undefined : Report.parse(baselineInput);
  const names = Object.keys(current.metrics).sort();
  assert.deepEqual(names, Object.keys(budgets).sort(), 'Every measured metric needs a budget');
  if (baseline) {
    assert.equal(current.workload, baseline.workload, 'Workload is not comparable');
    assert.deepEqual(current.environment, baseline.environment, 'Environment is not comparable');
    assert.deepEqual(names, Object.keys(baseline.metrics).sort(), 'Baseline metrics are not comparable');
  }
  const failures: string[] = [];
  for (const [name, ceiling] of Object.entries(budgets)) {
    const measured = current.metrics[name] ?? Infinity;
    if (measured > ceiling) failures.push(`${name}: ${measured} exceeds budget ${ceiling}`);
    const previous = baseline?.metrics[name];
    if (previous !== undefined && measured > previous * 1.2)
      failures.push(`${name}: regression exceeds 20% (${previous} -> ${measured})`);
  }
  return { comparison: baseline ? 'checked' : 'not-checked', failures };
}
