import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('first message is enabled and page is accessible', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Message', { exact: true }).fill('How long does delivery take?');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCSS('opacity', '1');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('answers remain visible across turns and ticket approval works', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'How long does delivery take?', exact: true }).click();
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
  await page.getByLabel('Message', { exact: true }).fill('My order arrived damaged');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByTestId('turn')).toHaveCount(2);
  await expect(page.getByTestId('assistant').first()).toContainText('delivery.md');
  await expect(page.getByRole('alertdialog')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('turn').last()).toHaveCSS('opacity', '1');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('assistant').last()).toContainText('I created a support ticket');
  await page.screenshot({ path: test.info().outputPath('chat.png'), fullPage: true });
});
