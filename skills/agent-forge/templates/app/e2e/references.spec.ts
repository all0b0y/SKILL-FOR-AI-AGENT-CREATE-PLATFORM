import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const reference = process.env.AF_REFERENCE ?? 'support';
const titles: Record<string, string> = {
  support: 'Support assistant',
  researcher: 'Document researcher',
  background: 'Scheduled digests',
};

test('reference identity, grounded answer and reload are accessible', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('header')).toContainText(titles[reference] ?? 'invalid reference');
  if (reference !== 'support')
    await expect(page.getByRole('button', { name: 'My order arrived damaged' })).toHaveCount(0);
  await page
    .getByLabel('Message', { exact: true })
    .fill(reference === 'support' ? 'How long does delivery take?' : 'Compare delivery and returns');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const answer = page.getByTestId('assistant');
  await expect(answer).toContainText('delivery.md');
  if (reference !== 'support') {
    await expect(answer).toContainText('returns.md');
    await expect(answer).toContainText(
      reference === 'researcher' ? 'Source comparison' : 'Scheduled evidence digest',
    );
  }
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
  await expect(page.getByTestId('turn')).toHaveCSS('opacity', '1');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${reference}-reference.png`), fullPage: true });
});
