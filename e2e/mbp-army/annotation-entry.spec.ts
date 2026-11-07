// One real Expo web app -> authenticated Bun bridge -> fixture ACP agent per journey.
// The entry and error paths are driven through visible controls, never through a store hook.
import { test, expect, openChat, send, web } from './fixtures';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

for (const width of [390, 800]) {
  test(`annotation-entry: window button opens annotation at ${width}`, async ({ page, bridge }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await openChat(page, bridge, `${web}?annotateEngine=skia`);
    await send(page, `annotation-entry ACP fixture at ${width}`);
    await expect(page.getByText(`ARMY_REPLY: annotation-entry ACP fixture at ${width}`).first()).toBeVisible();

    const button = page.getByTestId('chat-annotate');
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', 'Annotate this screen');
    const bounds = await button.boundingBox();
    expect(bounds, 'visible Annotate action has layout').not.toBeNull();
    if (!bounds) throw Error('Annotate action has no bounds');
    expect(bounds.height, '44dp minimum touch target').toBeGreaterThanOrEqual(44);
    expect(bounds.x, 'button stays inside the viewport').toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width, 'button stays inside the viewport').toBeLessThanOrEqual(width + 0.5);

    await button.click({ noWaitAfter: true });
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pen mode: only the S Pen draws, fingers scroll' })).toHaveText('S Pen');
    await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeDisabled();

    // With no physical stylus observed, the ordinary mouse path must commit ink.
    await page.mouse.move(80, 400);
    await page.mouse.down();
    await page.mouse.move(260, 440, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`annotation-${width}.png`) });

    await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toHaveCount(0);
    await button.click({ noWaitAfter: true });
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();
  });
}

test('annotation-entry: pill exit and re-entry clear failed Send and cold reload closes mode', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge, `${web}?annotateEngine=skia`);

  // In the window, the camera pill expands the same AppNav that owns S Pen mode.
  await page.getByTestId('chat-window-pill').click({ noWaitAfter: true });
  const pill = page.getByTestId('spen-mode-pill').last();
  await expect(pill).toBeVisible();
  await expect(page.getByTestId('spen-mode-label').last()).toHaveText('Normal');
  await pill.click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
  await expect(page.getByTestId('spen-mode-label').last()).toHaveText('Annotate');
  await expect(page.getByRole('button', { name: 'Pen mode: only the S Pen draws, fingers scroll' })).toHaveText('S Pen');

  await page.mouse.move(80, 400);
  await page.mouse.down();
  await page.mouse.move(270, 440, { steps: 8 });
  await page.mouse.up();
  const send = page.getByRole('button', { name: 'Send annotation', exact: true });
  await expect(send).toBeEnabled();

  // Fail a real upload by taking this isolated browser offline, not by mocking the bridge.
  await page.context().setOffline(true);
  try {
    await send.click({ noWaitAfter: true });
    await expect(page.getByTestId('annotation-tray').getByRole('alert')).toBeVisible({ timeout: 20000 });
  } finally {
    await page.context().setOffline(false);
  }
  // Annotation covers the whole screen (C23), so the nav pill is under the overlay while it is on:
  // leave through the tray's Exit; the pill (which shares the same lifecycle) re-enters below.
  await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('spen-mode-label').last()).toHaveText('Normal');

  await pill.click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
  await expect(page.getByTestId('annotation-tray').getByRole('alert')).toHaveCount(0);
  await expect(send, 'failed upload keeps unsent ink').toBeEnabled();

  // A real browser reload must not persist the active overlay.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toHaveCount(0);
});
