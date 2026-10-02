/** Repeatable offline acceptance of all reference identities, backed by a disposable database. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env.local')) loadEnvFile('.env.local');
if (process.env.AF_ALLOW_TEST_DB_RESET !== '1')
  throw new Error(
    'Reference acceptance resets test tables; use a disposable DB and AF_ALLOW_TEST_DB_RESET=1',
  );
const env = {
  ...process.env,
  AF_MODEL: 'mock',
  AF_REFERENCE: 'support',
  AF_EMBEDDING_MODEL: 'hash',
  AF_ALLOW_PAID_EMBEDDINGS: '0',
  AF_ALLOW_PAID_CALLS: '0',
};
const checks = [];
function run(args, reference = 'support') {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: { ...env, AF_REFERENCE: reference } });
  checks.push({ reference, command: ['pnpm', ...args], exitCode: result.status });
  if (result.status !== 0) throw new Error(`Reference check failed: ${reference} ${args[0]}`);
}
let ok = false;
try {
  run(['exec', 'vitest', 'run', 'tests/references.test.ts']);
  run(['kb:ingest']);
  run(['build']);
  for (const reference of ['support', 'researcher', 'background'])
    run(
      [
        'exec',
        'playwright',
        'test',
        'e2e/references.spec.ts',
        '--output',
        `test-results/references-${reference}`,
      ],
      reference,
    );
  ok = true;
} finally {
  mkdirSync('.agent-forge', { recursive: true });
  writeFileSync(
    '.agent-forge/reference-checks.json',
    `${JSON.stringify({ ok, mode: 'offline-mock', at: new Date().toISOString(), checks }, null, 2)}\n`,
  );
}
