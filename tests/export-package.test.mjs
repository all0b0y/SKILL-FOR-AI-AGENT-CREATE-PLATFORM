import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-forge-export-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(path, text = 'Export test fixture, not production data.\n') {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  put('scripts/export-package.mjs');
  copyFileSync(resolve(import.meta.dirname, '../scripts/export-package.mjs'), join(root, 'scripts/export-package.mjs'));
  for (const suffix of ['', '-grill', '-architect', '-build', '-evals', '-ui']) put(`skills/agent-forge${suffix}/SKILL.md`);
  put('README.md');
  put('LICENSE');
  put('hooks/hooks.json', '{}');
  put('.claude-plugin/plugin.json', '{}');
  execFileSync('git', ['init', '-q'], { cwd: root });
  const out = join(root, '.agent-forge-tmp/export');
  return {
    root, out, put,
    run: () => spawnSync(process.execPath, ['scripts/export-package.mjs', out], { cwd: root, encoding: 'utf8' }),
  };
}

test('export includes source but excludes credentials and generated files even if tracked', (t) => {
  const f = fixture(t);
  const app = 'skills/agent-forge/templates/app';
  const excluded = ['.env.local', '.env.production', 'node_modules/x.js', '.next/x.js', 'coverage/x.json', 'test-results/x.png', '.lighthouseci/x.json', 'playwright-report/x.html', '.agent-forge/run.json', 'evals/results/x.json', 'AGENTS.md', 'CLAUDE.md', 'debug.log', 'tsconfig.tsbuildinfo'];
  for (const file of excluded) f.put(`${app}/${file}`);
  f.put(`${app}/.env.example`, 'AF_MODEL=mock\n');
  f.put(`${app}/src/main.ts`);
  f.put('.research/private.md');
  f.put('security-fixtures/prompt-injection.json', '[]\n');
  f.put('.gitignore', '.agent-forge-tmp/\n');
  execFileSync('git', ['add', '-f', `${app}/.env.local`], { cwd: f.root });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).skills, 6);
  for (const file of excluded) assert.equal(existsSync(join(f.out, app, file)), false, file);
  assert.equal(readFileSync(join(f.out, app, '.env.example'), 'utf8'), 'AF_MODEL=mock\n');
  for (const file of [`${app}/src/main.ts`, 'README.md', 'LICENSE', 'hooks/hooks.json', '.claude-plugin/plugin.json']) assert(existsSync(join(f.out, file)), file);
  assert.equal(existsSync(join(f.out, '.research')), false);
  assert.equal(existsSync(join(f.out, 'security-fixtures')), false);
});

test('existing export is never overwritten', (t) => {
  const f = fixture(t);
  mkdirSync(f.out, { recursive: true });
  writeFileSync(join(f.out, 'keep.txt'), 'preserved');
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(join(f.out, 'keep.txt'), 'utf8'), 'preserved');
});

test('export refuses a symlink instead of dereferencing it', (t) => {
  const f = fixture(t);
  f.put('outside.txt');
  symlinkSync(join(f.root, 'outside.txt'), join(f.root, 'skills/agent-forge/outside.txt'));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Only regular files/);
  assert.equal(existsSync(join(f.out, 'skills/agent-forge/outside.txt')), false);
});

test('missing sibling skill fails before producing an incomplete package', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'skills/agent-forge-ui/SKILL.md'));
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(f.out), false);
});
