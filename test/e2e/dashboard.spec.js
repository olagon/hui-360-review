import { test, expect } from '@playwright/test';

// Answer fast, go straight back to the list, and the count must be right.
test('the list shows every answer after a quick run through', async ({ page, request }) => {
  const admin = (path, method = 'GET', data) => request.fetch(`/api/admin${path}`, { method, data }).then((r) => r.json());
  let cycle = (await admin('/cycles')).cycles.find((c) => c.status === 'open');
  if (!cycle) cycle = await admin('/cycles', 'POST', { name: `Dashboard test ${Date.now()}`, closes_at: '2099-01-01' });
  const { id } = await admin('/staff', 'POST', { name: `Quick Answer ${Date.now()}` });
  if (cycle.status !== 'open') await admin(`/cycles/${cycle.id}/status`, 'POST', { status: 'open' });
  await admin(`/cycles/${cycle.id}/people`, 'PUT', { staff_id: id, on: true });
  const { link } = await admin(`/cycles/${cycle.id}/links/${id}`, 'POST', {});

  await page.goto(link);
  await page.getByRole('link', { name: 'Start' }).first().click();
  const box = page.locator('textarea.answer');
  // One word answers count. The number of questions depends on the cycle, so read it.
  await expect(page.getByText(/Question 1 of \d+/)).toBeVisible();
  const total = Number((await page.getByText(/Question 1 of \d+/).textContent()).match(/of (\d+)/)[1]);
  for (let i = 0; i < total; i++) {
    await expect(page.getByText(`Question ${i + 1} of ${total}`)).toBeVisible();
    await box.fill(['Proud', 'Loʻi', 'Patience', 'Yes', 'Plan', 'Grants'][i % 6]);
    await page.getByRole('button', { name: /Next|Finish/ }).click();
  }
  await page.getByRole('link', { name: 'Back to my list' }).click();
  const card = page.locator('.card').first();
  await expect(card).toContainText(`${total} of ${total} answered`);
  await expect(card).toContainText('Done');
});
