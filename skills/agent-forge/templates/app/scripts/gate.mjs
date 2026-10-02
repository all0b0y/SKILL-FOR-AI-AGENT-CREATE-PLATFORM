/** Executable phase gates. Never infer success from an old report or skip a failed check. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

const phase = process.argv[2];
if (existsSync('.env.local')) loadEnvFile('.env.local');
const plans = {
  build: [
    ['lint'],
    ['typecheck'],
    ['knip'],
    ['architecture'],
    ['check-tools'],
    ['test:coverage'],
    ['kb:ingest'],
    ['bench'],
    ['audit', '--audit-level=high'],
    ['build'],
  ],
  evals: [['evals:lint'], ['kb:ingest'], ['evals', '--split', 'all', '--repeat', '3']],
  ui: [['build'], ['test:e2e'], ['lighthouse']],
};
if (!Object.hasOwn(plans, phase)) throw new Error('Usage: node scripts/gate.mjs build|evals|ui');
if (phase === 'build' && process.env.AF_ALLOW_TEST_DB_RESET !== '1')
  throw new Error('Build gate truncates test tables. Use a disposable DB and set AF_ALLOW_TEST_DB_RESET=1.');
const checks = [];
let ok = true;
for (const args of plans[phase]) {
  const start = performance.now();
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env });
  checks.push({
    command: ['pnpm', ...args],
    exitCode: result.status,
    durationMs: Math.round(performance.now() - start),
  });
  if (result.status !== 0) {
    ok = false;
    break;
  }
}
mkdirSync('.agent-forge', { recursive: true });
writeFileSync(
  join('.agent-forge', `${phase}-checks.json`),
  `${JSON.stringify({ phase, ok, at: new Date().toISOString(), checks }, null, 2)}\n`,
);
if (!ok) process.exitCode = 1;
