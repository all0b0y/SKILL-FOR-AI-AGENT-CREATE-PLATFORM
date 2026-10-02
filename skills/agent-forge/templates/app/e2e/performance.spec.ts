import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, type Response, test } from '@playwright/test';
import budgets from '../performance-budgets.json' with { type: 'json' };
import { comparePerformance, performanceEnvironment } from '../scripts/performance';

// Local mock/queue/DB/render latency, NOT live-model TTFT or a mobile CPU simulation.
test('cold initial JS and first rendered text stay within the offline budgets', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const scripts = new Map<string, number>();
  const downloads: Promise<void>[] = [];
  const collect = (response: Response) => {
    if (response.request().resourceType() !== 'script') return;
    downloads.push(
      response.body().then((body) => {
        expect(response.ok()).toBe(true);
        scripts.set(response.url(), gzipSync(body, { level: 9 }).byteLength);
      }),
    );
  };
  page.on('response', collect);
  await page.goto('/', { waitUntil: 'networkidle' });
  await Promise.all(downloads);
  page.off('response', collect);
  expect(scripts.size).toBeGreaterThan(0);

  const firstTextMs: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (i > 0) await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByLabel('Message', { exact: true }).fill('How long does delivery take?');
    const start = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('assistant').locator('p.leading-relaxed')).toContainText(/\S/);
    firstTextMs.push((await page.evaluate(() => performance.now())) - start);
    // Do not leave jobs running while measuring the next first turn.
    await expect(page.getByTestId('assistant')).toContainText('delivery.md');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  }
  const sorted = [...firstTextMs].sort((a, b) => a - b);
  const report = {
    version: 1,
    workload: 'chat-first-turn-v1:20-samples:nearest-rank-p95:gzip9-external-scripts',
    environment: {
      ...performanceEnvironment(),
      browser: browser.version(),
      project: test.info().project.name,
      reference: process.env.AF_REFERENCE ?? 'support',
      transport: 'loopback-mock-hash',
    },
    at: new Date().toISOString(),
    firstTextMs,
    scripts: Object.fromEntries(scripts),
    metrics: {
      initialJsGzipBytes: [...scripts.values()].reduce((sum, bytes) => sum + bytes, 0),
      firstTextP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    },
  };
  const output = `.agent-forge/ui-performance-${test.info().project.name}.json`;
  const dir = process.env.AF_UI_BASELINE_DIR;
  const baselinePath = dir ? join(dir, `${test.info().project.name}.json`) : undefined;
  if (baselinePath)
    expect(realpathSync(baselinePath)).not.toBe(existsSync(output) ? realpathSync(output) : resolve(output));
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined;
  const acceptance = comparePerformance(report, budgets.ui, baseline);
  const artifact = JSON.stringify({ ...report, acceptance }, null, 2);
  mkdirSync('.agent-forge', { recursive: true });
  writeFileSync(output, `${artifact}\n`);
  await test.info().attach('ui-performance.json', { body: artifact, contentType: 'application/json' });
  expect(acceptance.failures).toEqual([]);
});
