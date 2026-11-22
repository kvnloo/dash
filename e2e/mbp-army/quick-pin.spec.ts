// A13: blockers/approvals pin on the main input bar. Counts real pending work (a fixture ACP
// permission request, the seeded bulk-safe gate proposal) and opens Quick mode, the dashboard.
import { test, expect, openChat, send } from './fixtures';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('quick pin on the main input counts what waits on the owner and opens Quick mode', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await send(page, 'ARMY_PERMISSION pin request');
  await expect(page.getByTestId('permission-choice-army-allow-once')).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });

  const pin = page.getByTestId('quick-pin');
  await expect(pin).toHaveText('⚡ 1 need OK · 1 upstream', { timeout: 15_000 });
  await expect(pin).toHaveAttribute('aria-label', '1 need OK · 1 upstream. Open Quick mode');
  await page.screenshot({ path: info.outputPath('pin.png') });
  await pin.click({ noWaitAfter: true });
  await expect(page.getByTestId('mode-surface-quick')).toBeVisible();
  await expect(pin, 'pin hides while Quick is open').toHaveCount(0);
  await expect(page.getByTestId('quick-approvals-count')).toHaveText('1 need OK · 1 upstream bulk-safe (dry run)', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Allow all 1 pending requests once', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Confirm allow 1 once', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('quick-approvals-count')).toHaveText('0 need OK · 1 upstream bulk-safe (dry run)', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Close Quick mode', exact: true }).click({ noWaitAfter: true });
  await expect(pin).toHaveText('⚡ 1 upstream');
});
