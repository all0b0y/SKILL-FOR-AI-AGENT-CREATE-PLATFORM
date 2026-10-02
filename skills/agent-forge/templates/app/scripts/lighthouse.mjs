import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

// Evaluate only results produced in this invocation; stale reports never satisfy a gate.
mkdirSync('.lighthouseci', { recursive: true });
const outputDir = mkdtempSync('.lighthouseci/check-');
const assertions = JSON.parse(readFileSync('lighthouserc.json', 'utf8')).ci.assert.assertions;
const server = spawn(process.execPath, ['scripts/e2e-server.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, AF_MODEL: 'mock' },
});
const closed = once(server, 'exit');
try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      ready = (await fetch('http://127.0.0.1:3100/', { signal: AbortSignal.timeout(1000) })).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, 'Lighthouse server did not become ready');
  const scores = [];
  for (let i = 0; i < 3; i++) {
    const chrome = await launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ['--headless'],
      logLevel: 'silent',
    });
    try {
      const result = await lighthouse('http://127.0.0.1:3100/', {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
      });
      assert(result && !result.lhr.runtimeError, 'Lighthouse failed to produce a valid report');
      writeFileSync(`${outputDir}/run-${i + 1}.json`, JSON.stringify(result.lhr));
      scores.push(
        Object.fromEntries(
          Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score]),
        ),
      );
    } finally {
      await chrome.kill();
    }
  }
  writeFileSync(`${outputDir}/scores.json`, `${JSON.stringify(scores, null, 2)}\n`);
  for (const [name, [severity, rule]] of Object.entries(assertions)) {
    assert.equal(severity, 'error');
    assert(['median', 'pessimistic'].includes(rule.aggregationMethod));
    const category = name.replace(/^categories:/, '');
    const values = scores.map((s) => s[category]);
    assert(
      values.every((v) => typeof v === 'number' && Number.isFinite(v)),
      `Missing ${category} score`,
    );
    values.sort((a, b) => a - b);
    const actual = rule.aggregationMethod === 'median' ? values[1] : values[0];
    assert(actual >= rule.minScore, `${category}: ${actual} < ${rule.minScore}`);
  }
  console.log(JSON.stringify({ outputDir, scores }));
} finally {
  if (server.exitCode === null) server.kill('SIGTERM');
  await closed;
}
