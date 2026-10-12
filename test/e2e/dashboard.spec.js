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
  for (const [i, word] of ['Proud', 'Loʻi', 'Patience', 'Yes', 'Plan', 'Grants'].entries()) {
    await expect(page.getByText(`Question ${i + 1} of 6`)).toBeVisible();
    await box.fill(word);
    await page.getByRole('button', { name: /Next|Finish/ }).click();
  }
  await page.getByRole('link', { name: 'Back to my list' }).click();
  const card = page.locator('.card').first();
  await expect(card).toContainText('6 of 6 answered');
  await expect(card).toContainText('Done');
});
