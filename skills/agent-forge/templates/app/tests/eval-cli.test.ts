import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

function bench(models: string, caseId: string) {
  // No DB or paid provider may be contacted by invalid benchmark configuration.
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/evals/cli.ts', 'bench', '--models', models, '--case', caseId],
    {
      cwd: process.cwd(),
      env: { ...process.env, AF_MODEL: 'mock', AF_JUDGE_MODEL: 'mock', AF_ALLOW_PAID_CALLS: '0' },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}

test('benchmark rejects duplicate models instead of claiming a cheapest model from an empty run', () => {
  const result = bench('mock,mock', 'missing-case-fixture');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('distinct models');
  expect(result.stdout).not.toContain('Cheapest model');
});

test('benchmark rejects an empty case selection before requesting paid consent or calling a model', () => {
  const result = bench('mock,anthropic/test-fixture-not-contacted', 'missing-case-fixture');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('no cases selected');
  expect(result.stderr).not.toContain('Paid calls require');
  expect(result.stdout).not.toContain('Cheapest model');
});
