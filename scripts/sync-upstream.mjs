#!/usr/bin/env node
/** Stage pinned originals for review; never overwrite adapted vendor content or its attribution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Fetch only declared files at an immutable revision into a new, atomic snapshot directory. */
export async function stageUpstream(source, output, request = fetch) {
  const repo = source.repo.match(/^https:\/\/github\.com\/([a-zA-Z0-9][\w.-]*)\/([a-zA-Z0-9][\w.-]*)$/);
  assert(repo, 'Expected an exact GitHub repository URL');
  assert(/^[a-f0-9]{40}$/.test(source.revision), 'Expected a full lowercase 40-character commit SHA');
  assert(source.files.length > 0 && new Set(source.files).size === source.files.length, 'Expected unique files');
  for (const file of source.files)
    assert(typeof file === 'string' && !file.includes('\\') && file.split('/').every(p => p && p !== '.' && p !== '..'), 'Invalid upstream file path');
  assert(!existsSync(output), 'Destination already exists; snapshots never overwrite');
  const staging = `${output}.partial`;
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(staging); // An existing staging directory is also a refusal, not permission to delete it.
  try {
    const files = [];
    for (const file of source.files) {
      const url = `https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/${source.revision}/${file.split('/').map(encodeURIComponent).join('/')}`;
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      assert(response.ok, `Upstream HTTP ${response.status}: ${file}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length <= 2_000_000, `Upstream file too large: ${file}`);
      const path = join(staging, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: 'wx' });
      files.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    }
    const report = { repo: source.repo, revision: source.revision, files };
    writeFileSync(join(staging, 'snapshot.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    renameSync(staging, output);
    return report;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const [name, option, revision] = process.argv.slice(2);
  if (name === '--help') {
    console.log('Usage: node scripts/sync-upstream.mjs <vendor> [--revision <full-commit-sha>]\nStages declared originals and LICENSE for manual diff/review. Does not rewrite adapted files.');
    return;
  }
  assert(name && /^[a-z0-9-]+$/.test(name), 'Expected a vendor name');
  assert(!option || (option === '--revision' && revision && process.argv.length === 5), 'Expected --revision <full-commit-sha>');
  const manifests = readdirSync(join(root, 'skills')).map(skill => join(root, 'skills', skill, 'vendor', name, 'UPSTREAM.md')).filter(existsSync);
  assert.equal(manifests.length, 1, 'Expected exactly one matching vendor manifest');
  const text = readFileSync(manifests[0], 'utf8');
  const field = name => text.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1];
  const source = { repo: field('Repo'), revision: revision ?? field('Commit')?.split(' ')[0], files: [...(field('Files') ?? '').split(', ').filter(Boolean), 'LICENSE'] };
  const output = join(root, '.agent-forge-tmp', 'upstream', name, source.revision);
  const report = await stageUpstream(source, output);
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
