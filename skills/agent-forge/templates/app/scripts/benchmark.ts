import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import budgets from '../performance-budgets.json' with { type: 'json' };
import { type Msg, windowStart } from '../src/agent/window';
import { rrf } from '../src/memory/retrieve';
import { comparePerformance, performanceEnvironment } from './performance';

const output = '.agent-forge/benchmarks.json';
const baselinePath = process.env.AF_BENCH_BASELINE;
if (baselinePath)
  assert.notEqual(
    realpathSync(baselinePath),
    existsSync(output) ? realpathSync(output) : resolve(output),
    'Baseline must be a separate file; never overwrite the accepted baseline',
  );
const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined;

/** Fixed workload; ceilings catch algorithmic changes, matching baselines catch >20% growth. */
function sample(name: string, fn: () => unknown) {
  for (let i = 0; i < 10; i++) fn();
  const samples = Array.from({ length: 40 }, () => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return { name, p95Ms: samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity, samples };
}
const ids = Array.from({ length: 10_000 }, (_, i) => String(i));
const reverse = [...ids].reverse();
const history: Msg[] = Array.from({ length: 10_000 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: 'x'.repeat(100),
}));
const results = [
  sample('rrf/20000 candidates', () => rrf([ids, reverse])),
  sample('window/10000 messages', () => windowStart(history, 24_000)),
];
const report = {
  version: 1,
  workload: 'hot-paths-v1:10-warmup:40-samples:nearest-rank-p95',
  environment: performanceEnvironment(),
  at: new Date().toISOString(),
  results,
  metrics: { rrfP95Ms: results[0]?.p95Ms, windowP95Ms: results[1]?.p95Ms },
};
const acceptance = comparePerformance(report, budgets.hotPaths, baseline);
mkdirSync('.agent-forge', { recursive: true });
writeFileSync(output, `${JSON.stringify({ ...report, acceptance }, null, 2)}\n`);
console.table(results.map(({ name, p95Ms }) => ({ name, p95Ms })));
console.log(`Regression comparison: ${acceptance.comparison}`);
assert.equal(acceptance.failures.length, 0, acceptance.failures.join('\n'));
