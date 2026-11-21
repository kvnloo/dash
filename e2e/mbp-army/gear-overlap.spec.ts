// The dev-client Tools gear (expo-dev-menu FAB: 52dp, 16dp margin, right edge by default) floats
// above React Native on the turbo preview. On a 1440×3120 phone (384×832 dp at 3.75x) it covered
// the annotation tray's "Aa"/"Exit" chips. The web army cannot draw the native gear, so
// ?devToolsGutter=1 turns on the same gutter a dev-client build gets and the journey checks that no
// floating control lands in the gear's column. Without the flag (release builds) the full width stays.
import { test, expect, openChat, web } from './fixtures';
import type { Locator } from 'playwright/test';

const WIDTH = 384, HEIGHT = 832, DPR = 1440 / 384;
const GEAR_LEFT = WIDTH - 16 - 52; // the gear's left edge when it rests on the right edge

test.use({ deviceScaleFactor: DPR });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

async function rightEdges(buttons: Locator): Promise<{ name: string; right: number }[]> {
  const out: { name: string; right: number }[] = [];
  for (const button of await buttons.all()) {
    if (!await button.isVisible()) continue;
    const box = await button.boundingBox();
    if (box) out.push({ name: (await button.getAttribute('aria-label')) ?? '?', right: box.x + box.width });
  }
  return out;
}

for (const gutter of [true, false]) {
  test(`gear-overlap: annotation tray and Learn panel ${gutter ? 'keep the dev gear column clear' : 'use the full width without the gear'} at 1440x3120`, async ({ page, bridge }, info) => {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await openChat(page, bridge, `${web}?annotateEngine=skia${gutter ? '&devToolsGutter=1' : ''}`);

    await page.getByTestId('chat-annotate').click({ noWaitAfter: true });
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
    const tray = page.getByTestId('annotation-tray');
    await expect(tray.getByRole('button', { name: 'Type a note', exact: true })).toBeVisible();
    await expect(tray.getByRole('button', { name: 'Exit annotation', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`tray-${gutter ? 'gutter' : 'full'}.png`) });
    const chips = await rightEdges(tray.getByRole('button'));
    expect(chips.length, 'tray chips are laid out').toBeGreaterThan(8);
    const widest = Math.max(...chips.map(c => c.right));
    if (gutter) {
      for (const chip of chips) expect(chip.right, `${chip.name} stays left of the gear column`).toBeLessThanOrEqual(GEAR_LEFT + 0.5);
    } else {
      expect(widest, 'release layout keeps using the right edge').toBeGreaterThan(GEAR_LEFT);
    }
    await tray.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toHaveCount(0);

    // Learn panel: reach it through the mode pill whatever the cycle order.
    await page.getByTestId('chat-window-pill').click({ noWaitAfter: true });
    const label = page.getByTestId('spen-mode-label').last();
    for (let tap = 0; tap < 4 && (await label.textContent()) !== 'Learn'; tap++) {
      await page.getByTestId('spen-mode-pill').last().click({ noWaitAfter: true });
      if (await page.getByLabel('Annotation mode on', { exact: true }).count()) await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
    }
    const panel = page.getByTestId('mode-surface-learn');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    if (!box) throw Error('Learn panel has no layout');
    if (gutter) expect(box.x + box.width, 'Learn panel stays left of the gear column').toBeLessThanOrEqual(GEAR_LEFT + 0.5);
    else expect(box.x + box.width, 'release Learn panel uses the right edge').toBeGreaterThan(GEAR_LEFT);
    await page.screenshot({ path: info.outputPath(`learn-${gutter ? 'gutter' : 'full'}.png`) });
  });
}
