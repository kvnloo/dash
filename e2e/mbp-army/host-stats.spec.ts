import { test, expect, pair, openChat } from './fixtures';
import { parseHostStats } from '../../shared/protocol';

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('host info sheet shows local CPU, RAM, disk and load from the authenticated bridge', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  const host = page.locator('[data-testid^="tree-row-host:"]').first();
  await expect(host).toBeVisible();
  const id = await host.getAttribute('data-testid');
  if (!id) throw Error('Missing host row identity');
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/hosts/stats') && r.status() === 200);
  await host.click({ delay: 650, noWaitAfter: true });
  const sheet = page.getByTestId('host-info-sheet');
  await expect(sheet).toBeVisible();
  const response = await responsePromise;
  expect(response.headers()['cache-control']).toBe('no-store');
  const raw: unknown = await response.json();
  const stats = parseHostStats(raw);
  if (!stats) throw Error('Invalid stats response from fixture bridge');
  expect(id).toBe(`tree-row-host:${stats.hostId}`);
  expect(stats.memory?.totalBytes).toBeGreaterThan(0);
  expect(stats.disk?.totalBytes).toBeGreaterThan(0);
  const row = sheet.getByTestId('host-stats-row');
  await expect(row).toContainText(`CPU sampling… · ${stats.cpuCount} cores`);
  const gib = (bytes: number) => (bytes / 1073741824).toFixed(1);
  if (!stats.memory || !stats.disk || !stats.load) throw Error('Linux fixture must report RAM, root disk and load');
  await expect(row).toContainText(`RAM ${gib(stats.memory.usedBytes)}/${gib(stats.memory.totalBytes)} GiB`);
  await expect(row).toContainText(`Disk / ${gib(stats.disk.usedBytes)}/${gib(stats.disk.totalBytes)} GiB`);
  await expect(row).toContainText(`Load ${stats.load.one.toFixed(2)} / ${stats.load.five.toFixed(2)} / ${stats.load.fifteen.toFixed(2)}`);
  // Next poll is a real /proc/stat delta, not CPU usage since boot or a load estimate.
  await expect(row).toContainText(/CPU \d+%/, { timeout: 20000 });
  const bounds = await row.boundingBox();
  if (!bounds) throw Error('Missing rendered stats row');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('host-stats-390.png') });
  // The same real endpoint cannot disclose hardware evidence without a credential.
  expect((await page.request.get(`http://127.0.0.1:${bridge.port}/hosts/stats`)).status()).toBe(401);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click({ noWaitAfter: true });
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('host-stats-row')).toHaveCount(0);
});

test('chat host info sheet shows resources without replacing session identity', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await page.getByTestId('chat-window-badge').click({ noWaitAfter: true });
  const sheet = page.getByTestId('chat-window-identity');
  await expect(sheet.getByTestId('host-stats-row')).toContainText(/CPU .*cores/);
  await expect(sheet.getByTestId('host-stats-row')).toContainText(/RAM .*GiB/);
  await expect(sheet.getByTestId('chat-window-session-id')).toBeVisible();
  await expect(sheet.getByTestId('chat-window-provenance')).toBeVisible();
});
