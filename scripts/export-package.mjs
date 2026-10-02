#!/usr/bin/env node
/** Export a clean, self-contained plugin without local credentials or build/test artifacts. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? '.agent-forge-tmp/package');
assert(!existsSync(output), 'Output already exists. Choose a new directory; exports never overwrite.');
const candidates = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean);
const selected = [...new Set(candidates)].filter((path) => {
  if (!/^(skills\/|hooks\/|\.claude-plugin\/|scripts\/|README\.md$|RELEASE\.md$|LICENSE$)/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((part) => ['node_modules', '.next', '.agent-forge', 'coverage', 'test-results', '.lighthouseci', 'playwright-report'].includes(part))) return false;
  if (parts.some((part) => part.startsWith('.env') && part !== '.env.example')) return false;
  if (/\.(log|tsbuildinfo)$/.test(path) || /(?:^|\/)(AGENTS|CLAUDE)\.md$/.test(path)) return false;
  return !path.includes('/evals/results/');
}).sort();
assert.equal(selected.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).length, 6, 'Expected all six sibling skills');
for (const path of selected) {
  const source = resolve(root, path);
  assert(lstatSync(source).isFile(), `Only regular files can be exported: ${path}`);
  const target = resolve(output, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
console.log(JSON.stringify({ output, files: selected.length, skills: 6 }));
