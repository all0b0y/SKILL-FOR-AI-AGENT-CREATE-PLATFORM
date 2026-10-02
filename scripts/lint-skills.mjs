#!/usr/bin/env node
// lint-skills — deterministic structure checks for the agent-forge skill set.
// Usage: node scripts/lint-skills.mjs        (exit 0 = green)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { INDEX, readRules, renderIndex } from './build-practices-index.mjs';

const ROOT = join(import.meta.dirname, '..');
const SKILLS = join(ROOT, 'skills');
const MAX_LINES = 500;
const MAX_DESCRIPTION = 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_DUP_CHARS = 120;

const errors = [];
const err = (file, msg) => errors.push(`ERROR: ${relative(ROOT, file)}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).filter((n) => !['node_modules', '.next', '.git', 'coverage', 'test-results', 'playwright-report'].includes(n)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  return Object.fromEntries(
    m[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].replace(/^["']|["']$/g, '')]),
  );
}

// 1. Every skill: valid frontmatter, name = directory, bounded size.
const skillDirs = readdirSync(SKILLS).filter((d) => statSync(join(SKILLS, d)).isDirectory());
for (const dir of skillDirs) {
  const file = join(SKILLS, dir, 'SKILL.md');
  if (!existsSync(file)) {
    err(join(SKILLS, dir), 'no SKILL.md.');
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const fm = frontmatter(text);
  if (!fm) {
    err(file, 'missing YAML frontmatter.');
    continue;
  }
  if (fm.name !== dir) err(file, `frontmatter name "${fm.name}" must equal the directory name "${dir}".`);
  if (!NAME.test(fm.name ?? '') || fm.name.length > 64) err(file, 'name must be lowercase a-z0-9 with single hyphens, max 64 chars.');
  if (!fm.description) err(file, 'description is empty.');
  else if (fm.description.length > MAX_DESCRIPTION) err(file, `description is ${fm.description.length} chars; max ${MAX_DESCRIPTION}.`);
  if (!fm.license) err(file, 'license is missing (MIT for our own skills).');
  const lines = text.split('\n').length;
  if (lines > MAX_LINES) err(file, `${lines} lines; max ${MAX_LINES}. Move reference material into references/.`);
  if (dir !== 'agent-forge' && !/^Use when /.test(fm.description ?? '')) {
    err(file, 'phase skill description must start with "Use when" so the router and the model reach it reliably.');
  }
}

// 2. Every relative Markdown link inside skills resolves.
const mdFiles = walk(SKILLS).filter((f) => f.endsWith('.md') && !f.includes(`${'/'}vendor${'/'}`));
for (const file of mdFiles) {
  const text = readFileSync(file, 'utf8').replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) err(file, `broken link "${m[1]}".`);
  }
}

// 3. Practices: every rule well-formed, IDs unique, index regenerated.
const { rules, errors: ruleErrors } = readRules(ROOT);
errors.push(...ruleErrors);
const seen = new Map();
for (const r of rules) {
  if (seen.has(r.id)) errors.push(`ERROR: rule ${r.id} appears in ${seen.get(r.id)} and ${r.phase}.`);
  seen.set(r.id, r.phase);
}
if (!existsSync(INDEX) || readFileSync(INDEX, 'utf8') !== renderIndex(rules)) {
  errors.push('ERROR: practices-index.md is out of date. Run: node scripts/build-practices-index.mjs');
}

// 4. No duplicated meaning: identical long paragraphs across skill files.
const paragraphs = new Map();
for (const file of mdFiles) {
  if (file === INDEX) continue;
  const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const para of text.split(/\n\s*\n/)) {
    const norm = para.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm.length < MIN_DUP_CHARS || norm.startsWith('|') || norm.startsWith('- **')) continue;
    const h = createHash('sha1').update(norm).digest('hex');
    if (paragraphs.has(h) && paragraphs.get(h) !== file) {
      err(file, `paragraph duplicated from ${relative(ROOT, paragraphs.get(h))}: "${norm.slice(0, 60)}…". Keep one source of truth and link to it.`);
    }
    paragraphs.set(h, file);
  }
}

// 5. Vendored upstream content keeps license and provenance.
for (const dir of skillDirs) {
  const vendor = join(SKILLS, dir, 'vendor');
  if (!existsSync(vendor)) continue;
  for (const pkg of readdirSync(vendor)) {
    const p = join(vendor, pkg);
    if (!statSync(p).isDirectory()) continue;
    const files = readdirSync(p);
    if (!files.some((f) => /^LICENSE/i.test(f))) err(p, 'vendored package has no LICENSE file copied from upstream.');
    const up = join(p, 'UPSTREAM.md');
    if (!existsSync(up)) err(p, 'vendored package has no UPSTREAM.md (repo, commit, license, what was modified).');
    else {
      const t = readFileSync(up, 'utf8');
      for (const key of ['Repo:', 'Commit:', 'License:', 'Modified:']) if (!t.includes(key)) err(up, `missing "${key}" line.`);
      if (/Apache/i.test(t) && !files.some((f) => /^NOTICE/i.test(f))) err(p, 'Apache-2.0 content needs a NOTICE file stating it was modified.');
    }
  }
}

// 6. Plugin manifest and hooks reference real files.
const hooksFile = join(ROOT, 'hooks', 'hooks.json');
const hooks = JSON.parse(readFileSync(hooksFile, 'utf8'));
for (const groups of Object.values(hooks.hooks)) {
  for (const g of groups) {
    for (const h of g.hooks) {
      for (const a of h.args ?? []) {
        if (a.startsWith('${CLAUDE_PLUGIN_ROOT}/')) {
          const p = join(ROOT, a.slice('${CLAUDE_PLUGIN_ROOT}/'.length));
          if (!existsSync(p)) err(hooksFile, `hook script ${a} does not exist.`);
        }
      }
      if (!h.timeout) err(hooksFile, `hook "${h.args?.join(' ')}" has no explicit timeout (a timed-out PreToolUse hook fails open).`);
    }
  }
}

if (errors.length) {
  for (const e of errors) process.stderr.write(`${e}\n`);
  process.stderr.write(`\nlint-skills: ${errors.length} problem(s).\n`);
  process.exit(1);
}
process.stdout.write(`lint-skills: OK — ${skillDirs.length} skills, ${rules.length} rules, ${mdFiles.length} markdown files.\n`);
