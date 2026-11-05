import { test, expect, openChat, web } from './fixtures';
import { enterAnnotation, openAnnotation, penDoubleTap, stroke } from './annotation';

test('annotation-launch: Skia entry has no ink alert in the first three seconds', async ({ page, bridge }) => {
  await openAnnotation(page, bridge, 'skia');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.waitForTimeout(3000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText("Ink couldn't load")).toHaveCount(0);
});

test('annotation-launch: failed CanvasKit load reports skia-load and Retry permits a stroke', async ({ page, bridge }) => {
  // Web ShimmerText fetches CanvasKit at startup. The loopback-only probe in
  // skia-ready.web.ts lets us abort a real WASM request after pairing instead.
  await openChat(page, bridge, web + '?annotateEngine=skia&inkWasmProbe=1');
  await page.route('**/canvaskit.wasm', route => route.abort());
  await enterAnnotation(page);
  await expect(page.getByRole('alert').filter({ hasText: 'skia-load' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry ink renderer' })).toBeVisible();
  await page.unroute('**/canvaskit.wasm');
  await page.getByRole('button', { name: 'Retry ink renderer' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await stroke(page);
  await expect(page.getByRole('button', { name: 'Send annotation' })).toBeEnabled();
});

test('annotation-launch: empty pen double-tap does not send or report an error', async ({ page, bridge }) => {
  await openAnnotation(page, bridge, 'skia');
  await penDoubleTap(page);
  await page.waitForTimeout(320);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Draw something first.')).toHaveCount(0);
  await expect(page.getByText('Sending…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send annotation' })).toBeDisabled();
});

test('annotation-launch: pen double-tap offers three-second Undo and retains unsent ink', async ({ page, bridge }) => {
  const uploads: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/attachments?')) uploads.push(request.url());
  });
  await openAnnotation(page, bridge, 'skia');
  await stroke(page);
  await penDoubleTap(page);
  await expect(page.getByText('Sending…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo sending', exact: true }).click();
  await expect(page.getByText('Sending…', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(3200);
  await expect(page.getByLabel('Annotation mode on')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send annotation' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(uploads).toEqual([]);
});
