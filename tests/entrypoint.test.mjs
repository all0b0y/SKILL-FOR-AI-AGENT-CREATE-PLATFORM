import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const skillDir = resolve(import.meta.dirname, '../skills/agent-forge');

// Installed skills are often reached through a symlink (~/.hermes/skills/<name>, macOS /tmp).
// A CLI that silently exits 0 there would make every guard look like a pass.
for (const [name, script, args, expected] of [
  ['af', 'scripts/af.mjs', ['check-command', 'git push --force origin main'], 1],
  ['hook', 'scripts/hooks/hook.mjs', ['destructive-guard'], null],
]) {
  test(`${name} runs when invoked through a symlinked skill directory`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'af-symlink-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const link = join(dir, 'agent-forge');
    symlinkSync(skillDir, link);
    const input = name === 'hook' ? JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }) : '';
    const result = spawnSync(process.execPath, [join(link, script), ...args], { encoding: 'utf8', input });
    if (expected !== null) assert.equal(result.status, expected, result.stderr);
    assert.match(`${result.stdout}${result.stderr}`, /\S/, 'CLI produced no output: entry-point check failed');
  });
}
