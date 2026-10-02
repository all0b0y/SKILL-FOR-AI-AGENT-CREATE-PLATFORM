import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

it('a requested benchmark baseline is mandatory, not an ignored optional hint', () => {
  const missing = `.agent-forge/missing-baseline-${randomUUID()}.json`;
  const result = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env.local', '--import', 'tsx', 'scripts/benchmark.ts'],
    { encoding: 'utf8', env: { ...process.env, AF_BENCH_BASELINE: missing } },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('ENOENT');
  expect(result.stderr).toContain(missing);
});
