import { test, expect, openChat, send } from './fixtures';
import type { Page } from 'playwright/test';

// Physical panel sizes mapped to logical viewports at DPR 3; native density is
// user-configurable. Geometry must depend on logical layout, not panel pixels.
for (const phone of [
 { name: 'S25 Ultra', width: 480, height: 1040 },
 { name: 'S22+', width: 360, height: 780 },
]) {
 test.describe(phone.name, () => {
  test.use({ viewport: { width: phone.width, height: phone.height }, deviceScaleFactor: 3 });
  test('prompt preview follows the selected rail bar and stays inside the viewport', async ({ page, bridge }, info) => {
   await openChat(page, bridge);
   for (let index = 0; index < 4; index++) {
    await send(page, `popover anchor ${index}`);
    await expect(page.getByText(new RegExp(`ARMY_REPLY: popover anchor ${index}`)).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
   }
   const rail = page.getByLabel('Prompt navigator', { exact: true });
   const ticks = rail.getByTestId('rail-tick');
   await expect(ticks).toHaveCount(4);
   const preview = page.getByLabel('Turn preview', { exact: true });
   for (const index of [0, 3]) {
    const bar = await ticks.nth(index).boundingBox();
    const track = await rail.boundingBox();
    if (!bar || !track) throw Error('Rail geometry unavailable');
    await page.mouse.move(track.x + track.width / 2, bar.y + bar.height / 2);
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(`Prompt ${index + 1}/4`);
    await expectAnchored(page, index);
   }
   // Expanding the actions changes the card's measured height, not its anchor.
   await page.getByRole('button', { name: 'Continue', exact: true }).click();
   await expect(preview).toContainText('Replace the composer draft');
   await expectAnchored(page, 3);
   // Reflow the open rail without closing/reopening the preview.
   await page.mouse.move(8, 8);
   await page.setViewportSize({ width: phone.height, height: phone.width });
   await expectAnchored(page, 3);
   await page.getByRole('button', { name: 'Replace draft', exact: true }).scrollIntoViewIfNeeded();
   await expect(page.getByRole('button', { name: 'Replace draft', exact: true })).toBeInViewport({ ratio: 1 });
   await page.screenshot({ path: info.outputPath('anchored-preview.png') });
   await page.getByRole('button', { name: 'Close turn preview', exact: true }).scrollIntoViewIfNeeded();
   await page.getByRole('button', { name: 'Close turn preview', exact: true }).click();
   await expect(preview).toHaveCount(0);
   expect(bridge.logs()).toContain('pair.claim');
   expect(bridge.logs()).toContain('ws.open');
   await page.screenshot({ path: info.outputPath('final.png') });
  });
 });
}

async function expectAnchored(page: Page, index: number) {
 const rail = page.getByLabel('Prompt navigator', { exact: true });
 const preview = page.getByLabel('Turn preview', { exact: true });
 await expect(preview).toBeInViewport({ ratio: 1 });
 await expect.poll(async () => {
  const bar = await rail.getByTestId('rail-tick').nth(index).boundingBox();
  const track = await rail.boundingBox();
  const card = await preview.boundingBox();
  const viewport = page.viewportSize();
  if (!bar || !track || !card || !viewport) return Infinity;
  const expectedTop = Math.max(12, Math.min(viewport.height - card.height - 12,
   bar.y + bar.height / 2 - card.height / 2));
  const expectedLeft = Math.max(12, Math.min(viewport.width - card.width - 12,
   track.x - card.width - 4));
  return Math.max(Math.abs(card.y - expectedTop), Math.abs(card.x - expectedLeft));
 }, { message: 'Preview is beside the selected bar, centered vertically unless viewport-clamped' }).toBeLessThanOrEqual(2);
}
