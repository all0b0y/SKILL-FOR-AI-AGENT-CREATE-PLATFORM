import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageUpstream } from '../scripts/sync-upstream.mjs';

test('upstream staging is pinned, preserves exact bytes and refuses an existing destination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-upstream-'));
  const output = join(root, 'snapshot');
  const source = { repo: 'https://github.com/example/skills', revision: 'a'.repeat(40), files: ['reference/a.md', 'LICENSE'] };
  const urls = [];
  const request = async (url) => { urls.push(String(url)); return new Response('original content\n'); };
  try {
    const report = await stageUpstream(source, output, request);
    assert.equal(readFileSync(join(output, 'reference/a.md'), 'utf8'), 'original content\n');
    assert.equal(report.files.length, 2);
    assert(urls.every(url => url.startsWith(`https://raw.githubusercontent.com/example/skills/${source.revision}/`)));
    await assert.rejects(stageUpstream(source, output, request), /already exists/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
