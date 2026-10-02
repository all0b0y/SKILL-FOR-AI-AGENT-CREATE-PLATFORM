import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('SSE reconnect reports the outage and resumes text without duplicating its prefix', async ({ page }) => {
  let lastSeq = '';
  let expectedText = '';
  const resumed = page.waitForRequest(
    async (request) =>
      request.url().includes('/events') && (await request.headerValue('last-event-id')) !== null,
  );
  await page.route(
    '**/api/runs/*/events*',
    async (route) => {
      const response = await route.fetch();
      const frames = (await response.text()).trim().split('\n\n');
      const textFrames = frames.filter((f) => f.includes('event: text\n'));
      expect(textFrames.length).toBeGreaterThan(1);
      expectedText = textFrames.map((f) => JSON.parse(f.split('data: ')[1] ?? '{}').text).join('');
      const first = frames.findIndex((f) => f.includes('event: text\n'));
      lastSeq = frames[first]?.match(/^id: (\d+)/)?.[1] ?? '';
      expect(lastSeq).not.toBe('');
      // End the HTTP body without the terminal SSE event: native EventSource must reconnect.
      await route.fulfill({ response, body: `${frames.slice(0, first + 1).join('\n\n')}\n\n` });
    },
    { times: 1 },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'How long does delivery take?', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Connection interrupted' })).toBeVisible();
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
  await expect(page.getByRole('status').filter({ hasText: 'Connection interrupted' })).toHaveCount(0);
  expect(await (await resumed).headerValue('last-event-id')).toBe(lastSeq);
  const answer = page.getByTestId('assistant').locator('p.leading-relaxed');
  await expect(answer).toHaveText(expectedText.replace(/\[([\w./-]+\.md)\]/g, '$1'));
  await expect(page.getByTestId('turn')).toHaveCount(1);
});

test('lost approval acknowledgement reloads authoritative state without asking twice', async ({ page }) => {
  let decisions = 0;
  await page.route('**/api/runs/*/approval', async (route) => {
    decisions++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('connectionreset');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'My order arrived damaged', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('assistant')).toContainText('I created a support ticket');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(decisions).toBe(1);
  await page.reload();
  await expect(page.getByTestId('assistant')).toContainText('I created a support ticket');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('authentication failure on a retry cannot discard an uncertain delivery key', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/api/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      expect((await route.fetch()).ok()).toBe(true);
      return route.abort('connectionreset');
    }
    if (bodies.length === 2)
      return route.fulfill({ status: 401, json: { error: 'Identity temporarily unavailable' } });
    return route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'How long does delivery take?', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry sending', exact: true });
  await retry.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Identity temporarily unavailable' })).toBeVisible();
  await expect(retry).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await retry.click();
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual(bodies[0]);
});

test('lost stop acknowledgement removes the pending approval from authoritative state', async ({ page }) => {
  await page.route('**/api/runs/*/cancel', async (route) => {
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort('connectionreset');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'My order arrived damaged', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('assistant')).toContainText('Stopped.');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('assistant')).toContainText('Stopped.');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

// Intercept only the browser transport: the real server, queue and mock worker still run.
test('retry after a lost POST acknowledgement recovers the same durable run', async ({ page }) => {
  const requests: unknown[] = [];
  let accepted: { runId: string; conversationId: string } | undefined;
  await page.route('**/api/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length !== 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    accepted = await response.json();
    // The transaction committed, but the client cannot know that.
    await route.abort('connectionreset');
  });
  await page.goto('/');
  await page.getByLabel('Message', { exact: true }).fill('How long does delivery take?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry sending', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'How long does delivery take?', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Retry sending', exact: true }).click();
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page).toHaveURL(`/?conversation=${accepted?.conversationId}`);
  const history = await page.request.get('/api/runs');
  expect(history.ok()).toBe(true);
  const body = (await history.json()) as { runs: { id: string; conversationId: string }[] };
  expect(body.runs.filter((r) => r.conversationId === accepted?.conversationId).map((r) => r.id)).toEqual([
    accepted?.runId,
  ]);
  await page.reload();
  await expect(page.getByTestId('turn')).toHaveCount(1);
  await expect(page.getByTestId('assistant')).toContainText('delivery.md');
});
