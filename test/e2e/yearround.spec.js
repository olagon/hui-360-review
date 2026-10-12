import { test, expect } from '@playwright/test';

// Year round, with no review needed: a sign in link from People, a goal, a public mahalo,
// and a feedback request that the coworker answers from their own phone.
test('goals, mahalo, and feedback work between reviews', async ({ browser, request }) => {
  const admin = (path, method = 'GET', data) => request.fetch(`/api/admin${path}`, { method, data }).then((r) => r.json());
  const stamp = Date.now();
  const { id: aId } = await admin('/staff', 'POST', { name: `Year Asker ${stamp}`, team: 'Ops' });
  const { id: bId } = await admin('/staff', 'POST', { name: `Year Helper ${stamp}`, team: 'Ops' });
  await admin(`/kuleana/${bId}`, 'PUT', { title: 'Field lead', responsibilities: 'Loʻi workdays', works_with: [aId] });

  const a = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await a.goto((await admin(`/staff/${aId}/link`, 'POST', {})).link);
  await a.goto('/me/');

  await a.locator('#goal-new').fill(`Lead a workday ${stamp}`);
  await a.locator('#goal-add').click();
  await expect(a.locator('#huli')).toContainText(`Lead a workday ${stamp}`);

  await a.locator('#m-to').selectOption(String(bId));
  await a.locator('#m-body').fill(`Mahalo for the loʻi ${stamp}`);
  await a.locator('#m-send').click();
  await expect(a.locator('#mahalo')).toContainText(`Mahalo for the loʻi ${stamp}`);

  await a.locator('#f-to').selectOption(String(bId));
  await a.locator('#f-prompt').fill(`How did the workday go ${stamp}?`);
  await a.locator('#f-ask').click();
  await expect(a.locator('#feedback')).toContainText(`How did the workday go ${stamp}?`);

  await a.goto('/mahalo/');
  await expect(a.locator('main')).toContainText(`Mahalo for the loʻi ${stamp}`);
  await a.goto('/kuleana/');
  await expect(a.locator('main')).toContainText('Loʻi workdays');

  // The coworker sees the ask on their home page and answers it.
  const b = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await b.goto((await admin(`/staff/${bId}/link`, 'POST', {})).link);
  await b.getByRole('link', { name: 'Answer now' }).click();
  await b.locator('[data-answer]').first().fill(`It went well ${stamp}`);
  await b.locator('[data-send-answer]').first().click();
  await expect(b.locator('#feedback')).not.toContainText('Waiting for your answer');

  await a.goto('/me/#feedback');
  await expect(a.locator('#feedback')).toContainText(`It went well ${stamp}`);
});
