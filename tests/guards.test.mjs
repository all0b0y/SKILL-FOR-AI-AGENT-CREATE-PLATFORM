import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide } from '../skills/agent-forge/scripts/hooks/hook.mjs';
import { closePhase } from '../skills/agent-forge/scripts/lib/gates.mjs';
import {
  checkDestructive, checkPaid, checkPhaseWrite, checkSecretCommand, checkSecretWrite,
} from '../skills/agent-forge/scripts/lib/guards.mjs';
import { emptyState, markClosed, status, writeState } from '../skills/agent-forge/scripts/lib/state.mjs';

const here = import.meta.dirname;
const fixture = (p) => readFileSync(join(here, 'fixtures', p), 'utf8');
const FAKE_ANTHROPIC = `sk-ant-api03-${'a'.repeat(40)}`;
const FAKE_AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'af-'));
  writeState(root, emptyState());
  return root;
}
const put = (root, rel, text) => writeFileSync(join(root, rel), text);

// ------------------------------------------------------------------ destructive-guard
test('destructive-guard blocks dangerous commands', () => {
  for (const cmd of [
    'rm -rf /', 'rm -rf ~', 'rm -fr src', 'cd x && rm -Rf .', 'git push --force origin main', 'git push -f',
    'git reset --hard HEAD~3', 'git clean -fd', 'psql -c "DROP TABLE users"', 'echo x | psql -c "truncate orders"',
    'docker compose down -v', 'docker volume rm pgdata', 'pnpm drizzle-kit drop',
  ]) assert.equal(checkDestructive(cmd).decision, 'deny', cmd);
});

test('destructive-guard allows routine work', () => {
  for (const cmd of [
    'rm -rf node_modules .next', 'rm -rf ./dist', 'rm file.txt', 'rm -r src/old', 'git push --force-with-lease',
    'git push origin main', 'docker compose down', 'pnpm drizzle-kit generate', 'rm -rf /tmp/af-cache',
    'grep -r "drop" src',
  ]) assert.equal(checkDestructive(cmd).decision, 'allow', cmd);
});

// ------------------------------------------------------------------ secret-guard
test('secret-guard blocks keys in source files and commands', () => {
  assert.equal(checkSecretWrite('/p/src/llm.ts', `const k = "${FAKE_ANTHROPIC}"`).decision, 'deny');
  assert.equal(checkSecretWrite('/p/src/aws.ts', FAKE_AWS).decision, 'deny');
  assert.equal(checkSecretWrite('/p/.env.example', `ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}`).decision, 'deny');
  assert.equal(checkSecretCommand(`curl -H "x-api-key: ${FAKE_ANTHROPIC}" https://x`).decision, 'deny');
  assert.equal(checkSecretCommand('git add .env').decision, 'deny');
  assert.equal(checkSecretWrite('/p/src/db.ts', 'postgres://admin:hunter2secret@prod.example.com/app').decision, 'deny');
});

test('secret-guard allows env files, env lookups and local dev URLs', () => {
  assert.equal(checkSecretWrite('/p/.env.local', `ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}`).decision, 'allow');
  assert.equal(checkSecretWrite('/p/src/llm.ts', 'process.env.ANTHROPIC_API_KEY').decision, 'allow');
  assert.equal(checkSecretWrite('/p/docker-compose.yml', 'postgres://app:devpassword@db:5432/app').decision, 'allow');
  assert.equal(checkSecretCommand('git add .env.example').decision, 'allow');
});

// ------------------------------------------------------------------ paid-call-guard
test('paid-call-guard asks before live model calls only', () => {
  for (const cmd of ['pnpm evals:live', 'pnpm run eval:live --case x', 'node scripts/model-bench.mjs', 'claude plugin eval .', 'claude -p "hi"', 'curl https://api.anthropic.com/v1/messages']) {
    assert.equal(checkPaid(cmd).decision, 'ask', cmd);
  }
  for (const cmd of ['pnpm af:evals-gate', 'pnpm test', 'claude plugin eval init --bare first-case', 'pnpm evals']) {
    assert.equal(checkPaid(cmd).decision, 'allow', cmd);
  }
});

// ------------------------------------------------------------------ phase state + gate
test('phase-gate locks app code until grill and architect close, and reopens on spec change', () => {
  const root = project();
  const app = join(root, 'src', 'agent.ts');
  assert.equal(checkPhaseWrite(join(root, '.agent-forge', 'AGENT_SPEC.md')).decision, 'allow');
  assert.equal(checkPhaseWrite(join(root, '.agent-forge', 'state.json')).decision, 'deny');
  assert.match(checkPhaseWrite(app).reason, /"grill" is open/);

  put(root, '.agent-forge/AGENT_SPEC.md', fixture('support-spec.md'));
  assert.ok(closePhase(root, 'grill').ok);
  markClosed(root, 'grill');
  assert.match(checkPhaseWrite(app).reason, /"architect" is open/);

  assert.equal(closePhase(root, 'architect').ok, false, 'no ARCHITECTURE.md yet');
  put(root, '.agent-forge/ARCHITECTURE.md', fixture('support-architecture.md'));
  assert.ok(closePhase(root, 'architect').ok);
  markClosed(root, 'architect');
  assert.equal(checkPhaseWrite(app).decision, 'allow');
  assert.equal(status(root).current, 'build');

  // Editing the spec after closing reopens grill and everything after it.
  put(root, '.agent-forge/AGENT_SPEC.md', `${fixture('support-spec.md')}\n`);
  const st = status(root);
  assert.equal(st.phases[0].status, 'stale');
  assert.equal(st.phases[1].status, 'stale');
  assert.equal(checkPhaseWrite(app).decision, 'deny');
});

test('close refuses to skip a phase', () => {
  const root = project();
  const res = closePhase(root, 'architect');
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /phase "grill" is open/);
});

test('build gate delegates to the app script and writes the report', () => {
  const root = project();
  put(root, '.agent-forge/AGENT_SPEC.md', fixture('support-spec.md'));
  markClosed(root, 'grill');
  put(root, '.agent-forge/ARCHITECTURE.md', fixture('support-architecture.md'));
  markClosed(root, 'architect');
  assert.match(closePhase(root, 'build').errors[0], /no "af:build-gate" script/);
  put(root, 'package.json', JSON.stringify({ scripts: { 'af:build-gate': 'true' } }));
  const red = closePhase(root, 'build', { run: () => ({ status: 1, stdout: 'tsc: 3 errors', stderr: '' }) });
  assert.equal(red.ok, false);
  const green = closePhase(root, 'build', { run: () => ({ status: 0, stdout: 'ok', stderr: '' }) });
  assert.ok(green.ok);
  assert.ok(JSON.parse(readFileSync(join(root, '.agent-forge/reports/build.json'), 'utf8')).ok);
});

// ------------------------------------------------------------------ hook adapter
test('hook adapter emits PreToolUse deny JSON and stays silent on allow', () => {
  const deny = decide('destructive-guard', { tool_name: 'Bash', tool_input: { command: 'rm -rf src' } });
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(deny.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(decide('destructive-guard', { tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  const ask = decide('paid-call-guard', { tool_name: 'Bash', tool_input: { command: 'pnpm evals:live' } });
  assert.equal(ask.hookSpecificOutput.permissionDecision, 'ask');
  const edit = decide('secret-guard', { tool_name: 'Edit', tool_input: { file_path: '/p/src/a.ts', new_string: FAKE_AWS } });
  assert.equal(edit.hookSpecificOutput.permissionDecision, 'deny');
});

test('typecheck-lint hook returns PostToolUse block with tool output', () => {
  const root = project();
  put(root, 'package.json', '{}');
  put(root, 'tsconfig.json', '{}');
  const run = (_cmd, args) => (args.includes('tsc') ? { status: 2, stdout: 'src/a.ts(1,1): error TS2322', stderr: '' } : { status: 0, stdout: '', stderr: '' });
  const out = decide('typecheck-lint', { tool_name: 'Write', tool_input: { file_path: join(root, 'src', 'a.ts') } }, { run });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /TS2322/);
  assert.equal(decide('typecheck-lint', { tool_name: 'Write', tool_input: { file_path: join(root, 'README.md') } }, { run }), null);
});
