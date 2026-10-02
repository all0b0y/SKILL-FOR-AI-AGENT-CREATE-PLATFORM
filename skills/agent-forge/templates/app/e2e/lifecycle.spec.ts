import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

async function requestTicket(page: Page) {
  await page.goto('/');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'My order arrived damaged', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(202);
  const { runId } = (await response.json()) as { runId: string };
  await expect(page.getByRole('alertdialog')).toBeVisible();
  return runId;
}

for (const action of ['reject', 'stop'] as const) {
  test(`${action} clears approval, survives reload and allows another turn`, async ({ page }) => {
    const runId = await requestTicket(page);
    if (action === 'reject') {
      await page.getByLabel('Note for the assistant (optional)').fill('Please do not create a ticket.');
      await page.getByRole('button', { name: 'Reject', exact: true }).click();
      await expect(page.getByTestId('assistant')).toContainText('I did not create a ticket');
    } else {
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(page.getByTestId('assistant')).toContainText('Stopped.');
    }
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const events = await page.request.get(`/api/runs/${runId}/events`);
    expect(events.ok()).toBe(true);
    expect(await events.text()).not.toContain('event: tool-result');
    await page.reload();
    await expect(page.getByTestId('assistant')).toContainText(
      action === 'reject' ? 'Rejected' : 'Not executed',
    );
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('How long does delivery take?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('assistant').last()).toContainText('delivery.md');
    await expect(page.getByTestId('turn')).toHaveCount(2);
  });
}

test('dark reduced-motion approval is keyboard reachable and accessible', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await requestTicket(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog).toHaveCSS('transform', 'none');
  await expect(page.getByTestId('turn')).toHaveCSS('transform', 'none');
  const note = page.getByLabel('Note for the assistant (optional)');
  await note.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dark-reduced-approval.png'), fullPage: true });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('assistant')).toContainText('I did not create a ticket');
});
