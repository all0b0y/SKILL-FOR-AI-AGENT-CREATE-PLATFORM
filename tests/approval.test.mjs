import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { agentAncestor, checkPhaseCommand, humanApproval } from '../skills/agent-forge/scripts/lib/approval.mjs';
import { decide } from '../skills/agent-forge/scripts/hooks/hook.mjs';
import { checkPhaseWrite } from '../skills/agent-forge/scripts/lib/guards.mjs';
import { emptyState, markClosed, status, writeState } from '../skills/agent-forge/scripts/lib/state.mjs';

const here = import.meta.dirname;
const AF = resolve(here, '../skills/agent-forge/scripts/af.mjs');
const fixture = (p) => readFileSync(join(here, 'fixtures', p), 'utf8');
const approve = () => 'test';

// Every test gets its own key directory, never the user's real ~/.agent-forge.
process.env.AF_HOME = mkdtempSync(join(tmpdir(), 'af-home-'));

function project() {
  const root = mkdtempSync(join(tmpdir(), 'af-lock-'));
  writeState(root, emptyState());
  writeFileSync(join(root, '.agent-forge', 'AGENT_SPEC.md'), fixture('support-spec.md'));
  writeFileSync(join(root, '.agent-forge', 'ARCHITECTURE.md'), fixture('support-architecture.md'));
  return root;
}
const stateOf = (root) => JSON.parse(readFileSync(join(root, '.agent-forge', 'state.json'), 'utf8'));

test('grill and architect cannot be closed without a human approval', () => {
  const root = project();
  // node --test runs without a TTY, exactly like an agent's shell tool.
  assert.throws(() => markClosed(root, 'grill'), /approval|terminal|agent/i);
  assert.equal(status(root).phases[0].status, 'open');
  markClosed(root, 'grill', new Date(), { approve });
  assert.equal(status(root).phases[0].status, 'closed');
  assert.equal(stateOf(root).phases.grill.approvedBy, 'test');
});

test('a hand-written close record, even with correct hashes, is unverified and unlocks nothing', () => {
  const root = project();
  markClosed(root, 'grill', new Date(), { approve });
  const forged = stateOf(root);
  // Exactly what the pressure-test agent did: copy the shape, recompute hashes, drop the signature.
  forged.phases.architect = { closedAt: new Date().toISOString(), hashes: { ...forged.phases.grill.hashes } };
  writeState(root, forged);
  assert.equal(status(root).phases[1].status, 'unverified');
  assert.equal(status(root).current, 'architect');
  assert.equal(checkPhaseWrite(join(root, 'src', 'agent.ts')).decision, 'deny');

  // Re-signing with a different key does not help either.
  const tampered = stateOf(root);
  tampered.phases.grill.approvedBy = 'agent';
  writeState(root, tampered);
  assert.equal(status(root).phases[0].status, 'unverified');
});

test('af close for a human phase refuses to run from a non-interactive session', () => {
  const root = project();
  const res = spawnSync(process.execPath, [AF, 'close', 'grill'], { cwd: root, encoding: 'utf8', env: { ...process.env } });
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stderr, /user's approval|user's decision/);
  assert.match(res.stderr, /close grill/);
  assert.equal(stateOf(root).phases.grill, undefined);
});

test('an AI-agent ancestor process is detected and refused even with a terminal', () => {
  const table = { 300: '200 -zsh', 200: '100 /usr/local/bin/codex exec --json', 100: '1 /sbin/launchd' };
  const run = (_cmd, args) => ({ stdout: `${table[args.at(-1)] ?? ''}\n` });
  if (process.platform !== 'win32') assert.match(agentAncestor(300, run), /codex/);
  const human = { 300: '200 -zsh', 200: '100 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal', 100: '1 /sbin/launchd' };
  assert.equal(agentAncestor(300, (_c, a) => ({ stdout: `${human[a.at(-1)] ?? ''}\n` })), null);
  process.env.CLAUDECODE = '1';
  try {
    assert.throws(() => humanApproval('grill'), /AI-agent session/);
  } finally {
    delete process.env.CLAUDECODE;
  }
});

test('agents are told to hand the close to the user, and cannot edit state or the key', () => {
  for (const cmd of [
    'node .agents/skills/agent-forge/scripts/af.mjs close grill',
    'af close architect',
    "node -e \"require('fs').writeFileSync('.agent-forge/state.json','{}')\"",
    'cat > .agent-forge/state.json <<EOF',
    'cat ~/.agent-forge/signing.key',
    'AF_HOME=/tmp/x af close grill',
  ]) assert.equal(checkPhaseCommand(cmd).decision, 'deny', cmd);
  for (const cmd of ['af status', 'af gate grill', 'cat .agent-forge/state.json', 'af close build', 'af validate-spec']) {
    assert.equal(checkPhaseCommand(cmd).decision, 'allow', cmd);
  }
  const hook = decide('phase-gate', { tool_name: 'Bash', tool_input: { command: 'af close grill' } });
  assert.equal(hook.hookSpecificOutput.permissionDecision, 'deny');
  const cli = spawnSync(process.execPath, [AF, 'check-command', 'af close grill'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /only the user closes "grill"/);
  assert.equal(checkPhaseWrite(join(process.env.AF_HOME, 'signing.key')).decision, 'deny');
});

test('in a real terminal, typing the phase name approves and signs; anything else cancels', { skip: process.platform === 'win32' }, () => {
  const helper = join(here, 'fixtures', 'tty-close.mjs');
  const spec = join(here, 'fixtures', 'support-spec.md');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CODEX_|HERMES_SESSION_ID|HERMES_KANBAN_TASK)/.test(k)));
  // A real pseudo-terminal (python3 pty), answering only once the prompt is on screen.
  const driver = `
import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:4])
out, sent, end = b"", False, time.time() + 15
while time.time() < end:
    if select.select([fd], [], [], 0.2)[0]:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if not sent and b"to cancel:" in out:
        os.write(fd, sys.argv[4].encode() + b"\\n")
        sent = True
os.waitpid(pid, 0)
sys.stdout.write(out.decode(errors="replace"))
`;
  const run = (answer) =>
    spawnSync('python3', ['-c', driver, process.execPath, helper, spec, answer], { encoding: 'utf8', env, timeout: 30_000 }).stdout;
  assert.match(run('grill'), /RESULT closed/);
  assert.match(run('yes'), /RESULT refused: Closing "grill" was not approved/);
});
