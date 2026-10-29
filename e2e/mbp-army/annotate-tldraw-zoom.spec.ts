import { test, expect } from './fixtures';
import { openAnnotation, stroke } from './annotation';
import { writeFile } from 'node:fs/promises';

// This journey deliberately uses wheel input and rendered DOM transforms rather
// than an editor global, store setter or test-only camera API.
test('annotate-tldraw: zoomed ink is normalized in capture page coordinates', async ({ page, bridge }, info) => {
  await openAnnotation(page, bridge);
  await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
  await page.mouse.move(240, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect.poll(() => page.locator('.tl-container').evaluate(element => Number(getComputedStyle(element).getPropertyValue('--tl-zoom')))).toBeGreaterThan(1);
  const camera = await page.locator('.tl-shapes').evaluate(element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const canvas = element.closest('.tl-canvas')!.getBoundingClientRect();
    const inverse = matrix.inverse();
    return { zoom: matrix.a, expected: [[80, 400], [260, 440]].map(([x, y]) => {
      const p = new DOMPoint(x! - canvas.left, y! - canvas.top).matrixTransform(inverse);
      return [p.x, p.y];
    }) };
  });
  await stroke(page);
  await expect(page.locator('[data-shape-type="draw"]')).toBeVisible();
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click();
  await expect(page.getByText('No words captured. Send the marks only?')).toBeVisible();
  // Armed once the confirmation is up: nothing uploads before Send anyway, so the confirmation's own
  // clicks under load must not eat the upload's wait.
  const uploaded = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/attachments?') && request.headers()['content-type'] === 'application/json');
  await page.getByRole('button', { name: 'Send anyway', exact: true }).click();
  const doc = JSON.parse((await uploaded).postDataBuffer()!.toString('utf8'));
  for (const [index, point] of doc.strokes[0].points.entries()) {
    const expected = camera.expected[index]!;
    // The HTML shape layer includes a subpixel anti-aliasing offset (< 0.5px).
    expect(point[0]).toBeCloseTo(expected[0]! / doc.screen.width, 2);
    expect(point[1]).toBeCloseTo(expected[1]! / doc.screen.height, 2);
    expect(point[0]).toBeGreaterThanOrEqual(0); expect(point[0]).toBeLessThanOrEqual(1);
    expect(point[1]).toBeGreaterThanOrEqual(0); expect(point[1]).toBeLessThanOrEqual(1);
  }
  await writeFile(info.outputPath('zoomed-contract.json'), JSON.stringify({ camera, doc }, null, 2));
  await page.screenshot({ path: info.outputPath('zoomed-sent.png') });
});
