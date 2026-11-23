// Themed mode (DA-095): the blueprint Living Ruins wallpaper behind Dash and elemental-ui stone
// controls, driven through Settings in the real Expo web app against a real isolated bridge.
// Living Night stays the default and draws neither.
import type { Page } from 'playwright/test';
import { test, expect, pair, composer, send, web } from './fixtures';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

/** The nearest painted background behind the Chats pane: transparent all the way up in themed mode. */
async function opaqueAncestors(page: Page) {
  return page.getByTestId('chats-pane').evaluate(node => {
    const hits: string[] = [];
    for (let el: Element | null = node; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      const alpha = m ? (m[1]!.split(',')[3] === undefined ? 1 : Number(m[1]!.split(',')[3])) : 0;
      if (alpha >= 0.99) hits.push(`${el.getAttribute('data-testid') ?? el.tagName}:${bg}`);
    }
    return hits;
  });
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click({ noWaitAfter: true });
  await page.getByTestId('settings-theme-night').or(page.getByTestId('settings-theme-elemental')).first().scrollIntoViewIfNeeded();
}

test('themed mode: Living Night stays the default with no wallpaper and no stone controls', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  await expect(page.getByTestId('themed-backdrop')).toHaveCount(0);
  await expect(page.getByTestId('blueprint-wallpaper')).toHaveCount(0);
  expect((await opaqueAncestors(page)).length).toBeGreaterThan(0);
  await openSettings(page);
  await expect(page.getByTestId('settings-theme-night')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-theme-blueprint')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('elemental-stone')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('night-settings.png') });
});

test('themed mode: Settings turns on Blueprint, the living wallpaper runs behind the chats, stone buttons work and the choice persists', async ({ page, bridge }, info) => {
  // Headless Chromium rasterises WebGL in software, which the wallpaper would skip for the poster: force the live tier.
  await pair(page, bridge, `${web}?wallpaper=webgl`);
  await openSettings(page);
  await page.getByTestId('settings-theme-blueprint').click({ noWaitAfter: true });
  await expect(page.getByTestId('themed-backdrop')).toBeAttached();
  await expect(page.getByTestId('settings-theme-elemental')).toBeVisible();
  await expect(page.getByTestId('settings-theme-blueprint')).toHaveAttribute('aria-checked', 'true');
  // The poster plate decodes, and the WebGL player comes up over it and keeps drawing frames.
  const poster = page.getByTestId('blueprint-wallpaper-poster').locator('img');
  await expect.poll(() => poster.evaluate(img => img instanceof HTMLImageElement && img.complete ? img.naturalWidth : 0), { timeout: 20000 }).toBe(1920);
  await expect(page.getByTestId('blueprint-wallpaper-host')).toHaveAttribute('data-tier', 'webgl');
  const live = page.locator('[data-testid="blueprint-wallpaper-live"]');
  await expect(live).toHaveAttribute('data-ready', '1', { timeout: 30000 });
  await expect(live).toHaveAttribute('data-fps', /\d/, { timeout: 30000 });
  const box = await live.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw Error('wallpaper canvas has no layout');
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
  // elemental-ui stone: the material buttons toggle (aria-pressed) and the primary action is stone too.
  await expect(page.getByTestId('elemental-material-basalt')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('elemental-material-slate').click({ noWaitAfter: true });
  await expect(page.getByTestId('elemental-material-slate')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('elemental-material-basalt')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('settings-theme-elemental').getByTestId('elemental-stone').first()).toBeAttached();
  await page.screenshot({ path: info.outputPath('blueprint-settings.png') });
  // Back on Chats: nothing opaque between the list and the wallpaper, and chatting still works.
  await page.getByRole('button', { name: 'Back', exact: true }).first().click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await expect.poll(() => opaqueAncestors(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('blueprint-chats.png') });
  await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
  await send(page, 'hello from blueprint');
  await expect(page.getByText('ARMY_REPLY: hello from blueprint').first()).toBeVisible();
  await expect(live).toHaveAttribute('data-ready', '1');
  await page.screenshot({ path: info.outputPath('blueprint-chat.png') });
  // Saved: a reload comes back themed with the slate stone; the URL can still force Living Night.
  await page.waitForTimeout(400);
  await page.goto(`${web}?wallpaper=poster`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('themed-backdrop')).toBeAttached({ timeout: 60000 });
  await expect(page.getByTestId('blueprint-wallpaper-host')).toHaveAttribute('data-tier', 'poster', { timeout: 20000 });
  await expect(page.locator('[data-testid="blueprint-wallpaper-live"]')).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByTestId('elemental-material-slate')).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${web}?theme=night`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab').nth(1)).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('themed-backdrop')).toHaveCount(0);
});

test('themed mode: the pairing screen uses the stone primary button and pairs', async ({ page, bridge }, info) => {
  await page.goto(`${web}?theme=blueprint&wallpaper=poster`, { waitUntil: 'domcontentloaded' });
  const pairButton = page.getByRole('button', { name: 'Pair over Tailscale', exact: true });
  await expect(pairButton).toBeVisible({ timeout: 120000 });
  await expect(pairButton.getByTestId('elemental-stone')).toBeAttached();
  await expect(page.getByTestId('themed-backdrop')).toBeAttached();
  await page.screenshot({ path: info.outputPath('blueprint-pair.png') });
  await pair(page, bridge, `${web}?theme=blueprint&wallpaper=poster`);
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await expect.poll(() => opaqueAncestors(page)).toEqual([]);
});

test('themed mode: Blueprint in desk mode keeps the wallpaper behind the desk shell and the desk working', async ({ page, bridge }, info) => {
  // DA-094 desk shell wraps the whole navigator: in themed mode it must not paint over the wallpaper.
  await page.setViewportSize({ width: 1920, height: 1080 });
  const url = `${web}?theme=blueprint&wallpaper=poster&desk=on`;
  await pair(page, bridge, url);
  await expect(page.getByTestId('desk-shell')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('desk-rail').getByRole('tab')).toHaveCount(9);
  await expect(page.getByTestId('themed-backdrop')).toBeAttached();
  await expect(page.getByTestId('blueprint-wallpaper-host')).toHaveAttribute('data-tier', 'poster', { timeout: 20000 });
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await expect.poll(() => opaqueAncestors(page)).toEqual([]);
  const shell = await page.getByTestId('desk-shell').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(shell).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  await page.screenshot({ path: info.outputPath('blueprint-desk.png') });
  // The desk still chats in its centre pane, and Settings keeps both the desk and the theme choices.
  await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
  await send(page, 'hello from the blueprint desk');
  await expect(page.getByText('ARMY_REPLY: hello from the blueprint desk').first()).toBeVisible();
  await page.getByTestId('desk-rail').getByRole('button', { name: 'Settings', exact: true }).click({ noWaitAfter: true });
  await page.getByTestId('settings-desk-on').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('settings-desk-on')).toBeVisible();
  await page.getByTestId('settings-theme-blueprint').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('settings-theme-blueprint')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-theme-elemental').getByTestId('elemental-stone').first()).toBeAttached();
  await expect(page.getByTestId('desk-shell')).toBeVisible();
  await page.screenshot({ path: info.outputPath('blueprint-desk-settings.png') });
});
