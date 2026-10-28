import { test, expect, openChat, send } from './fixtures';
import type { DashDebugApi } from '../../app/src/debug/expose';

// Simulate only the hardware input through the existing cutout fixture. Start at the
// unpaired scenario; all pairing, chat creation and replies still use the real isolated bridge.
test('camera pill and hole stay centred on a simulated non-square cutout rect', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.addInitScript(() => {
    const url = new URL(location.href);
    url.searchParams.set('debug', '1');
    url.searchParams.set('scenario', 'pair');
    history.replaceState(null, '', url);
  });
  await openChat(page, bridge);
  await send(page, 'camera geometry journey');
  await expect(page.getByText(/ARMY_REPLY: camera geometry journey/).first()).toBeVisible();

  // Neither input is a device measurement: off-centre/tall and near-edge/top-flush
  // rects catch width-only circles and both horizontal and vertical clamping drift.
  for (const rect of [
    { x: 176, y: 4, width: 20, height: 28 },
    { x: 70, y: 0, width: 30, height: 18 },
  ]) {
    await page.evaluate(async rect => {
      const api: DashDebugApi | undefined = window.__DASH_DEBUG__;
      if (!api) throw Error('Existing hardware fixture API was not exposed');
      await api.run({ action: 'setCutoutFixture', reading: {
        supported: true, rects: [rect], windowWidth: innerWidth, windowHeight: innerHeight,
        safeInsetTop: 44, rotation: 0,
      } });
    }, rect);
    const pill = page.getByTestId('chat-window-pill');
    const hole = page.getByTestId('chat-window-pill-hole');
    await expect(hole).toBeVisible();
    await expect.poll(async () => {
      const p = await pill.boundingBox(), h = await hole.boundingBox();
      if (!p || !h) return null;
      return [p.x + p.width / 2, p.y + p.height / 2,
        h.x + h.width / 2, h.y + h.height / 2, h.width, h.height];
    }).toEqual([rect.x + rect.width / 2, rect.y + rect.height / 2,
      rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width + 8, rect.height + 8]);
    await expect(page.getByTestId('chat-window-pill-shape').locator('path')).toHaveAttribute('fill-rule', 'evenodd');
    await expect(page.getByTestId('chat-window-pill-shape').locator('path')).toHaveAttribute('d', /V/);
    await page.screenshot({ path: info.outputPath(`cutout-${rect.x}-${rect.y}.png`) });
  }

  // Losing the hardware reading must restore the honest safe-area capsule, not a guessed lens.
  await page.evaluate(async () => {
    const api: DashDebugApi | undefined = window.__DASH_DEBUG__;
    if (!api) throw Error('Existing hardware fixture API was not exposed');
    await api.run({ action: 'setCutoutFixture', reading: null });
  });
  await expect(page.getByTestId('chat-window-pill-hole')).toHaveCount(0);
  await expect(page.getByTestId('chat-window-pill')).toBeVisible();
});
