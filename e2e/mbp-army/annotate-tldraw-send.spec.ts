import { test, expect } from './fixtures';
import { openAnnotation, stroke } from './annotation';
import { writeFile } from 'node:fs/promises';

test('annotate-tldraw: confirmed send removes only submitted ink, retaining newer ink', async ({ page, bridge }, info) => {
  await openAnnotation(page, bridge);
  await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
  await stroke(page);
  const ink = page.locator('[data-shape-type="draw"]');
  const first = await ink.getAttribute('data-shape-id');
  const network = await page.context().newCDPSession(page);
  // Throttle the real upload, never mock or intercept the bridge response. This
  // gives the user time to finish a second stroke while the first is in flight.
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 1000000, uploadThroughput: 20000 });
  await page.getByRole('button', { name: 'Send and keep drawing', exact: true }).click();
  await expect(page.getByText('No words captured. Send the marks only?')).toBeVisible();
  // Armed once the confirmation is up: nothing uploads before Send anyway, so the confirmation's own
  // clicks under load must not eat the upload's wait.
  const uploading = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/attachments?') && request.headers()['content-type'] === 'image/png');
  const confirmed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/attachments?') && response.request().headers()['content-type'] === 'image/png', { timeout: 45000 });
  await page.getByRole('button', { name: 'Send anyway', exact: true }).click();
  await uploading;
  // The busy preview expands the tray down to the lower part of the canvas.
  // Draw below that rendered tray, not over its Highlighter button.
  await page.mouse.move(100, 470); await page.mouse.down(); await page.mouse.move(280, 480); await page.mouse.up();
  await expect(ink).toHaveCount(2);
  await (await confirmed).finished();
  await expect(ink).toHaveCount(1, { timeout: 20000 });
  expect(await ink.getAttribute('data-shape-id')).not.toBe(first);
  await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();
  await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click();
  await expect(page.getByText('No words captured. Send the marks only?')).toBeVisible();
  // Armed once the confirmation is up: nothing uploads before Send anyway, so the confirmation's own
  // clicks under load must not eat the upload's wait.
  const nextUpload = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/attachments?') && request.headers()['content-type'] === 'application/json');
  await page.getByRole('button', { name: 'Send anyway', exact: true }).click();
  const bytes = (await nextUpload).postDataBuffer()!;
  const doc = JSON.parse(bytes.toString('utf8'));
  expect(doc.strokes.map((stroke: { id: number }) => stroke.id)).toEqual([2]);
  await writeFile(info.outputPath('retained-newer-ink.json'), bytes);
  await page.screenshot({ path: info.outputPath('retained-newer-ink.png') });
});
