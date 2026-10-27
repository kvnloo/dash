import { test, expect } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { openAnnotation, stroke } from './annotation';

test('annotate-tldraw: warm open, visible stroke, local assets and history', async ({ page, bridge }, info) => {
  const external: string[] = [];
  const ready: number[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) external.push(request.url());
  });
  page.on('console', async message => {
    if (message.text().startsWith('[annotate-tldraw] host-ready')) {
      const data: unknown = await message.args()[1]?.jsonValue();
      if (data && typeof data === 'object' && 'ms' in data && typeof data.ms === 'number') ready.push(data.ms);
    }
  });
  await openAnnotation(page, bridge);
  await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
  await stroke(page);
  const ink = page.locator('[data-shape-type="draw"]');
  await expect(ink).toBeVisible();
  await expect(ink.locator('svg path').first()).toHaveAttribute('d', /\S+/);
  await page.screenshot({ path: info.outputPath('visible-stroke.png') });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(ink).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(ink).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(ink).toHaveCount(0);
  await expect.poll(() => ready.length).toBeGreaterThan(0);
  expect(ready.every(ms => ms <= 600)).toBe(true);
  expect(external).toEqual([]);
  await writeFile(info.outputPath('tldraw-readiness-network.json'), JSON.stringify({ readyMs: ready, external }, null, 2));
});

test('annotate-tldraw: sent dash.annotation.v1 bytes and stroke markers match Skia', async ({ page, bridge }, info) => {
  const documents: string[] = [];
  const sent: string[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    if (typeof frame.payload === 'string' && frame.payload.includes('⟦stroke 1⟧')) sent.push(frame.payload);
  }));
  for (const engine of ['skia', 'tldraw'] as const) {
    await openAnnotation(page, bridge, engine);
    if (engine === 'tldraw') await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
    // Freeze the sample/session epoch, not rAF or performance timers. Same two
    // physical mouse endpoints go through each renderer's real input path.
    await page.clock.setFixedTime(1700000000000);
    await stroke(page);
    const uploaded = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/attachments?') && request.headers()['content-type'] === 'application/json');
    await page.getByRole('button', { name: 'Send annotation', exact: true }).click();
    const bytes = (await uploaded).postDataBuffer();
    expect(bytes).not.toBeNull();
    documents.push(bytes!.toString('utf8'));
    await expect.poll(() => sent.length).toBeGreaterThan(documents.length - 1);
    await writeFile(info.outputPath(`${engine}-sent.json`), documents.at(-1)!);
    await page.screenshot({ path: info.outputPath(`${engine}-sent.png`) });
  }
  const skia = JSON.parse(documents[0]!);
  const tldraw = JSON.parse(documents[1]!);
  expect(tldraw.schema).toBe('dash.annotation.v1');
  // Navigation creates fresh UUIDs; that is the sole non-fixture field.
  tldraw.screen.id = skia.screen.id;
  expect(JSON.stringify(tldraw, null, 1)).toBe(JSON.stringify(skia, null, 1));
  expect(tldraw.strokes[0].points).toHaveLength(2);
  for (const [x, y] of tldraw.strokes[0].points) {
    expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1);
  }
  await writeFile(info.outputPath('sent-marker-frames.json'), JSON.stringify(sent, null, 2));
});
