import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

function screenshotPath(name: string) {
  const dir = join('.agent-forge', 'ui-review', test.info().project.name);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

test('narrow view with 200% text handles long unbroken input without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByLabel('Message', { exact: true }).fill('x'.repeat(4000));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('turn')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })),
  ).toEqual({ width: 320, scroll: 320 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: screenshotPath('long-text.png') });
});

test('Runs lets the user reopen the exact saved conversation', async ({ page }) => {
  await page.goto('/');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'How long does delivery take?', exact: true }).click();
  const { runId, conversationId } = await (await created).json();
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
  expect(
    await page
      .getByRole('button', { name: /kb_search/ })
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await page.locator(`a[href="/runs/${runId}"]`).click();
  await expect(page.getByRole('link', { name: 'Open conversation', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.getByRole('list', { name: 'Timeline' })).not.toContainText('+-');
  await page.screenshot({ path: screenshotPath('run-detail.png'), fullPage: true });
  await page.getByRole('link', { name: 'Open conversation', exact: true }).click();
  await expect(page).toHaveURL(`/?conversation=${conversationId}`);
  await expect(page.getByTestId('turn')).toHaveCount(1);
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
});

test('pending approval fits a narrow view with 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByLabel('Message').fill(`My order arrived damaged ${'x'.repeat(600)}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
});

test('approval note and decision controls meet the touch target floor', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Message').fill('My order arrived damaged');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(
    await page
      .getByLabel('Note for the assistant (optional)')
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: screenshotPath('approval.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} chat controls meet the 44px touch target floor`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/');
    const small = await page.locator('a, button, input').evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)
          ? [{ name: node.textContent?.trim() || node.id, width: r.width, height: r.height }]
          : [];
      }),
    );
    expect(small).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: screenshotPath(`empty-${theme}.png`), fullPage: true });
  });
}
