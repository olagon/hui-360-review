import { test, expect } from '@playwright/test';

// Turn the network off mid answer, close the tab, reopen, and confirm nothing was lost.
test('answers survive going offline and closing the tab', async ({ context, page, request }) => {
  const admin = (path, method = 'GET', data) => request.fetch(`/api/admin${path}`, { method, data }).then((r) => r.json());

  let cycle = (await admin('/cycles')).cycles.find((c) => c.status === 'open');
  if (!cycle) {
    cycle = await admin('/cycles', 'POST', { name: `Offline test ${Date.now()}`, closes_at: '2099-01-01' });
    await admin(`/cycles/${cycle.id}/status`, 'POST', { status: 'open' });
  }
  const { id: staffId } = await admin('/staff', 'POST', { name: `Offline Tester ${Date.now()}` });
  await admin(`/cycles/${cycle.id}/people`, 'PUT', { staff_id: staffId, on: true }); // adds the self reflection
  const { link } = await admin(`/cycles/${cycle.id}/links/${staffId}`, 'POST', {});

  await page.goto(link);
  await page.getByRole('link', { name: 'Start' }).first().click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker, so the shell and questions get cached
  const url = page.url();
  const box = page.locator('textarea.answer');
  await box.fill('Before the signal dropped.');
  await expect(page.locator('.status')).toHaveText('Saved');

  await context.setOffline(true);
  await box.pressSequentially(' Typed with no signal.');
  await expect(page.locator('.status')).toHaveText('Saved on this phone, will sync when online');
  await page.close();

  const again = await context.newPage();
  await again.goto(url);
  await expect(again.locator('textarea.answer')).toHaveValue('Before the signal dropped. Typed with no signal.');
  await expect(again.locator('.sync-badge')).toHaveText('1 not synced yet');

  await context.setOffline(false);
  await again.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(again.locator('.sync-badge')).toBeHidden({ timeout: 20_000 });
  const aid = new URL(url).searchParams.get('a');
  const saved = await again.evaluate((a) => fetch(`/api/assignments/${a}`).then((r) => r.json()), aid);
  expect(saved.answers.map((x) => x.body)).toContain('Before the signal dropped. Typed with no signal.');
});
