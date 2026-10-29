// Desk mode (Samsung DeX / wide windows): the real Expo web app -> a real isolated bridge -> the
// fixture ACP agent, plus a loopback stand-in for the k3s phone queue that only the bridge reads.
// Everything is driven through visible controls, the mouse and the keyboard.
import type { Page } from 'playwright/test';
import { test, expect, createBridge, pair, openChat, composer, send, chatRow, web, type Bridge } from './fixtures';
import { startFixturePhoneQueue, type FixturePhoneQueue } from './fixture-phone-queue';

const SHOTS = process.env.DEX_SHOTS_DIR;
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

async function shot(page: Page, name: string, info: { outputPath(name: string): string }) {
  await page.screenshot({ path: info.outputPath(name) });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}` });
}

/** A bridge that samples its own utilization quickly and reads the phone queue fixture. */
async function deskBridge(queue?: FixturePhoneQueue): Promise<Bridge> {
  return createBridge(true, { env: {
    DASH_UTILIZATION_SAMPLE_MS: '500', DASH_UTILIZATION_BUCKET_MS: '2000',
    ...(queue ? { DASH_PHONE_QUEUE_URL: queue.url } : {}),
  } });
}

const panel = (page: Page, id: string) => page.getByTestId(`desk-panel-${id}`);

for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }]) {
  test(`desk mode at ${size.width}x${size.height} shows every panel and chats in the centre pane`, async ({ page }, info) => {
    const queue = await startFixturePhoneQueue();
    const bridge = await deskBridge(queue);
    const direct: string[] = [];
    page.on('request', request => { if (request.url().startsWith(queue.url)) direct.push(request.url()); });
    try {
      await page.setViewportSize(size);
      await openChat(page, bridge);
      await expect(page.getByTestId('desk-shell')).toBeVisible();
      // The phone pager chrome is gone; the rail is a tablist in the same order as Ctrl+1..9.
      const tabs = page.getByTestId('desk-rail').getByRole('tab');
      await expect(tabs).toHaveCount(9);
      await expect(tabs.nth(1)).toHaveAccessibleName('Chats');
      // Chats column and the open chat side by side, the chat inside the centre pane.
      const chats = await panel(page, 'chats').boundingBox();
      const center = await page.getByTestId('desk-center').boundingBox();
      const windowBox = await page.getByTestId('chat-window').boundingBox();
      if (!chats || !center || !windowBox) throw Error('desk columns have no layout');
      expect(chats.x + chats.width).toBeLessThanOrEqual(center.x + 1);
      expect(windowBox.x).toBeGreaterThanOrEqual(center.x - 1);
      expect(windowBox.x + windowBox.width).toBeLessThanOrEqual(center.x + center.width + 1);
      await send(page, `desk chat at ${size.width}`);
      await expect(page.getByText(`ARMY_REPLY: desk chat at ${size.width}`).first()).toBeVisible();
      await expect(chatRow(page)).toBeVisible();

      // Side panels: approvals (seeded gate), hosts with live stats + 24 h utilization, phone queue, workers, traces, build.
      await expect(panel(page, 'needs').getByText('Open approvals', { exact: false })).toBeVisible();
      const hosts = panel(page, 'hosts');
      await expect(hosts.getByTestId('host-stats-row')).toContainText(/RAM [\d.]+\/[\d.]+ GiB/);
      await expect(hosts.getByTestId('host-stats-row')).toContainText(/CPU \d+%/, { timeout: 25000 });
      await expect(hosts.getByTestId('desk-utilization-summary')).toContainText(/window · busy .* sampled\) · CPU avg \d+%/, { timeout: 25000 });
      const phones = panel(page, 'phones');
      await phones.scrollIntoViewIfNeeded();
      await expect(phones.getByTestId('desk-phone-s22')).toContainText('Galaxy S22+');
      await expect(phones.getByTestId('desk-phone-s22')).toContainText('battery 81%');
      await expect(phones.getByTestId('desk-phone-s25')).toContainText('owner using');
      await expect(phones.getByTestId('desk-phone-s25')).toContainText('battery 47%');
      // The live service's shape (gate + owner idle, no state word) is normalized too.
      await expect(phones.getByTestId('desk-phone-s25b')).toContainText('blocked');
      await expect(phones.getByTestId('desk-phone-s25b')).toContainText('s25 worker mode is off · owner idle 12h');
      await expect(phones.getByTestId('desk-phone-job-job4live')).toContainText('openai-codex/gpt-6-luna · fx');
      await expect(phones.getByTestId('desk-phone-job-counts')).toContainText('1 running');
      await expect(phones.getByTestId('desk-phone-job-counts')).toContainText('2 queued');
      await expect(phones.getByTestId('desk-phone-job-counts')).toContainText('1 succeeded');
      await expect(phones.getByTestId('desk-phone-job-job-1')).toContainText('ARMY phone job one');
      await expect(panel(page, 'workers')).toBeVisible();
      await expect(panel(page, 'traces').getByTestId('trace-entry')).toBeVisible();
      await expect(page.getByTestId('desk-build-chip')).toContainText('app ');
      await expect(page.getByTestId('desk-build-chip')).toContainText(/bridge (unreleased|[0-9a-f]{7})/);
      // The queue was read by the bridge, never by the app.
      expect(queue.hits()).toEqual(expect.arrayContaining(['/v1/devices', '/v1/jobs']));
      expect(direct).toEqual([]);
      await panel(page, 'needs').scrollIntoViewIfNeeded();
      await shot(page, `desk-${size.width}x${size.height}.png`, info);

      // Closing the chat window returns the centre pane to the Orchestra graph.
      await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
      await expect(page.getByTestId('desk-orchestra')).toBeVisible();
      await shot(page, `desk-${size.width}x${size.height}-orchestra.png`, info);
    } finally { await bridge.dispose(); await queue.stop(); }
  });
}

test('desk panels collapse, resize and keep both across a reload', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await pair(page, bridge);
  await expect(page.getByTestId('desk-shell')).toBeVisible();
  // Collapse Hosts from its header.
  await page.getByRole('button', { name: 'Collapse Hosts', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('desk-panel-body-hosts')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand Hosts', exact: true })).toBeVisible();
  // Drag the Chats column edge 120 px to the right.
  const before = await panel(page, 'chats').boundingBox();
  const edge = await page.getByTestId('desk-splitter-left').boundingBox();
  if (!before || !edge) throw Error('chats column or splitter missing');
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 60, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.move(edge.x + edge.width / 2 + 120, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await panel(page, 'chats').boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(Math.round(before.width) + 100);
  const resized = Math.round((await panel(page, 'chats').boundingBox())?.width ?? 0);
  // Drag the side column edge 80 px left: it grows.
  const sideBefore = await page.getByTestId('desk-side').boundingBox();
  const sideEdge = await page.getByTestId('desk-splitter-right').boundingBox();
  if (!sideBefore || !sideEdge) throw Error('side column or splitter missing');
  await page.mouse.move(sideEdge.x + sideEdge.width / 2, sideEdge.y + 300);
  await page.mouse.down();
  await page.mouse.move(sideEdge.x + sideEdge.width / 2 - 80, sideEdge.y + 300, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await page.getByTestId('desk-side').boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(Math.round(sideBefore.width) + 60);
  const sideResized = Math.round((await page.getByTestId('desk-side').boundingBox())?.width ?? 0);
  await shot(page, 'desk-resized.png', info);
  // Persisted: same layout after a cold reload.
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('desk-shell')).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Expand Hosts', exact: true })).toBeVisible();
  await expect(page.getByTestId('desk-panel-body-hosts')).toHaveCount(0);
  await expect.poll(async () => Math.round((await panel(page, 'chats').boundingBox())?.width ?? 0)).toBe(resized);
  await expect.poll(async () => Math.round((await page.getByTestId('desk-side').boundingBox())?.width ?? 0)).toBe(sideResized);
  // Collapse the whole Chats column and bring it back from its rail tab.
  await page.getByRole('button', { name: 'Collapse Chats', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane')).toHaveCount(0);
  await page.getByTestId('desk-rail').getByRole('tab', { name: 'Chats', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await page.getByRole('button', { name: 'Expand Hosts', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('desk-panel-body-hosts')).toBeVisible();
});

test('desk keyboard: Ctrl+K quick switch opens a chat, Ctrl+1..9 jump to panels, right-click opens the row menu', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openChat(page, bridge);
  await send(page, 'quick switch target');
  await expect(page.getByText('ARMY_REPLY: quick switch target').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('desk-orchestra')).toBeVisible();
  await expect(page.getByTestId('chat-window')).toHaveCount(0);

  // Ctrl+K, type, Enter: the chat opens in the centre pane.
  await page.keyboard.press('Control+k');
  const input = page.getByRole('textbox', { name: 'Quick switch', exact: true });
  await expect(input).toBeFocused();
  await input.fill('quick switch');
  await expect(page.getByTestId('quick-switch-item').first()).toContainText('quick switch target');
  await shot(page, 'desk-quick-switch.png', info);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-switch')).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await expect(page.getByText('ARMY_REPLY: quick switch target').first()).toBeVisible();
  // Escape closes the switcher without acting.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('quick-switch')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-switch')).toHaveCount(0);

  // Ctrl+3 = Orchestra (navigates the centre), Ctrl+4 = Phone queue, Ctrl+1 = Hosts.
  const tabs = page.getByTestId('desk-rail').getByRole('tab');
  await page.keyboard.press('Control+3');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await expect(page.getByTestId('desk-orchestra')).toBeVisible();
  await page.keyboard.press('Control+4');
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'phones')).toBeInViewport();
  await page.keyboard.press('Control+1');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, 'hosts')).toBeInViewport();
  // Ctrl+9 = the open chat again.
  await page.keyboard.press('Control+9');
  await expect(composer(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });

  // Right-click a chat row: the same menu as a long-press, nothing is sent.
  const sentBefore = (bridge.logs().match(/quick switch target/g) ?? []).length;
  await chatRow(page).hover();
  await chatRow(page).click({ button: 'right', noWaitAfter: true });
  await expect(page.getByRole('button', { name: /^Open /, exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete .* from this phone$/ })).toBeVisible();
  await shot(page, 'desk-row-menu.png', info);
  await page.getByRole('button', { name: /^Open /, exact: false }).first().click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  expect((bridge.logs().match(/quick switch target/g) ?? []).length).toBe(sentBefore);
});

test('desk mode degrades when the phone queue is unreachable and keeps annotation working', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openChat(page, bridge, `${web}?annotateEngine=skia`);
  await expect(panel(page, 'phones').getByTestId('desk-phone-queue-down')).toContainText('Phone queue unreachable');
  await expect(panel(page, 'phones').getByTestId('desk-phone-queue-down')).toContainText('nothing is sent from here');
  // Every other panel still works.
  await expect(panel(page, 'hosts').getByTestId('host-stats-row')).toContainText(/RAM [\d.]+\/[\d.]+ GiB/);
  await send(page, 'desk degraded chat');
  await expect(page.getByText('ARMY_REPLY: desk degraded chat').first()).toBeVisible();
  // Annotation from the chat window in desk mode: ink commits with the mouse.
  const button = page.getByTestId('chat-annotate');
  await expect(button).toBeVisible();
  await button.click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
  const center = await page.getByTestId('desk-center').boundingBox();
  if (!center) throw Error('centre pane missing');
  await page.mouse.move(center.x + 120, 420);
  await page.mouse.down();
  await page.mouse.move(center.x + 360, 470, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();
  await shot(page, 'desk-annotation.png', info);
  await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toHaveCount(0);
});

test('desk override: ?desk=off keeps the phone layout wide, the Settings choice forces desk on a narrower window', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await pair(page, bridge, `${web}?desk=off`);
  await expect(page.getByTestId('desk-shell')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  // Settings -> Desk layout On, at a width below the auto threshold.
  await page.setViewportSize({ width: 1000, height: 780 });
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab').nth(1)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByTestId('desk-shell')).toHaveCount(0);
  // The phone layout reaches Settings from the Chats header.
  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click({ noWaitAfter: true });
  await page.getByTestId('settings-desk-on').scrollIntoViewIfNeeded();
  await page.getByTestId('settings-desk-on').click({ noWaitAfter: true });
  await expect(page.getByTestId('settings-desk-on')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('desk-shell')).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('desk-shell')).toBeVisible({ timeout: 60000 });
  // A URL override still wins over the saved setting.
  await page.goto(`${web}?desk=off`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab').nth(1)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByTestId('desk-shell')).toHaveCount(0);
});

test('phone width 480x780 keeps the phone layout (no desk shell)', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 480, height: 780 });
  await openChat(page, bridge);
  await expect(page.getByTestId('desk-shell')).toHaveCount(0);
  await expect(page.getByTestId('desk-rail')).toHaveCount(0);
  await send(page, 'phone width regression');
  await expect(page.getByText('ARMY_REPLY: phone width regression').first()).toBeVisible();
  const box = await page.getByTestId('chat-window').boundingBox();
  if (!box) throw Error('chat window missing');
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(478);
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  // No hover/right-click menu on the phone layout.
  await chatRow(page).click({ button: 'right', noWaitAfter: true });
  await expect(page.getByRole('button', { name: /^Delete .* from this phone$/ })).toHaveCount(0);
  await shot(page, 'phone-480x780.png', info);
});

// One UI 9 (S25 Ultra) runs DeX inside the Samsung launcher on Android desktop windowing: no
// desktopmode service, no legacy DeX packages. The native detector reports that as `desktop`
// (a freeform window on a tablet-sized display, or an external presentation display); the web
// build's explicit simulation drives the same state so the layout decision is proven here.
// Native signal capture on the phones needs a new APK and is not proven by this spec.
test('One UI 9 DeX desktop-windowing signal turns desk on in a 1000-wide window and off when DeX ends', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 1000, height: 780 });
  await pair(page, bridge);
  await expect(page.getByTestId('desk-shell')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect.poll(() => page.evaluate('typeof window.__dashDex?.simulate')).toBe('function');
  await page.evaluate("window.__dashDex?.simulate({ mode: 'off', desktop: 'freeform-window' })");
  await expect(page.getByTestId('desk-shell')).toBeVisible();
  // Only the layout reacts: the legacy TV/Pad simulation stays off.
  await expect(page.getByTestId('dex-tv')).toHaveCount(0);
  await expect(page.getByTestId('desk-signal')).toContainText('Desk dex');
  await expect(page.getByTestId('desk-signal')).toContainText('DeX signal freeform-window');
  await page.evaluate("window.__dashDex?.simulate({ mode: 'off', desktop: 'external-display' })");
  await expect(page.getByTestId('desk-signal')).toContainText('DeX signal external-display');
  await page.evaluate("window.__dashDex?.simulate({ mode: 'off' })");
  await expect(page.getByTestId('desk-shell')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByTestId('chats-pane')).toBeVisible();
});
