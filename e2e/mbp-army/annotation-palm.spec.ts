import { test, expect } from './fixtures';
import { openAnnotation } from './annotation';

test('annotation-palm: pen stroke survives a second touch with every pen point', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAnnotation(page, bridge, 'skia');
  await page.getByRole('button', { name: 'Pen mode: only the S Pen draws, fingers scroll', exact: true }).click();
  // Highlighter preserves all freehand points (pen loops may be recognized as shapes).
  await page.getByRole('button', { name: 'Highlighter', exact: true }).click();

  // CDP dispatches trusted, simultaneous pen + touch PointerEvents to RNGH web.
  // No bridge, gesture, upload or network mocks: the real UI sends the resulting JSON.
  await page.evaluate(() => {
    document.addEventListener('pointerdown', event => {
      if (!event.isTrusted) return;
      if (event.pointerType === 'pen') document.body.dataset.armyPen = 'true';
      if (event.pointerType === 'touch') document.body.dataset.armyTouch = 'true';
    }, { capture: true });
  });
  const cdp = await page.context().newCDPSession(page);
  const pen = [
    { x: 92, y: 322 }, { x: 115, y: 336 }, { x: 140, y: 358 },
    { x: 163, y: 347 }, { x: 188, y: 370 }, { x: 212, y: 363 },
    { x: 234, y: 391 },
  ];
  const start = pen[0];
  const second = pen[1];
  const end = pen.at(-1);
  if (!start || !second || !end) throw Error('Pen path needs at least two points');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, button: 'none', buttons: 0, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await expect(page.locator('body')).toHaveAttribute('data-army-pen', 'true');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...second, button: 'none', buttons: 1, pointerType: 'pen' });

  // Palm touches down and lifts before the pen finishes; the active manual pan
  // must never enter FAILED, and its centroid must not leak into the ink.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 298, y: 415, id: 41 }] });
  await expect(page.locator('body')).toHaveAttribute('data-army-touch', 'true');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (const point of pen.slice(2)) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 1, pointerType: 'pen' });
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, pointerType: 'pen' });

  // A second finger immediately after pen-up must not create ink during the 250ms shield.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 270, y: 421, id: 42 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();

  // C19 adds an explicit words requirement. Supply the visible note when integrated.
  const note = page.getByRole('button', { name: 'Type a note', exact: true });
  if (await note.count() === 1) {
    await note.click();
    await page.getByRole('textbox', { name: 'Type a note', exact: true }).fill('Check this palm-rejected pen stroke.');
  }

  const upload = page.waitForRequest(request =>
    request.method() === 'POST' && request.url().includes('/attachments?') &&
    request.headers()['content-type'] === 'application/json');
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click();
  const bytes = (await upload).postDataBuffer();
  if (!bytes) throw Error('No annotation JSON was uploaded to the real bridge');
  const document: unknown = JSON.parse(bytes.toString('utf8'));
  if (!document || typeof document !== 'object' || !('strokes' in document) || !Array.isArray(document.strokes)) {
    throw Error('Bridge annotation document has no strokes');
  }
  expect(document.strokes).toHaveLength(1);
  const stroke: unknown = document.strokes[0];
  if (!stroke || typeof stroke !== 'object' || !('points' in stroke) || !Array.isArray(stroke.points)) {
    throw Error('Committed stroke has no points');
  }
  if (!('pointer' in stroke)) throw Error('Committed stroke has no pointer');
  expect(stroke.pointer).toBe('stylus');
  const points: readonly unknown[] = stroke.points;
  expect(points.length).toBeGreaterThanOrEqual(pen.length);
  for (const point of pen) {
    expect(points.some(sample => Array.isArray(sample) &&
      typeof sample[0] === 'number' && typeof sample[1] === 'number' &&
      Math.abs(sample[0] * 390 - point.x) < 2 &&
      Math.abs(sample[1] * 844 - point.y) < 2),
    `Missing pen point at ${point.x},${point.y}`).toBe(true);
  }
  expect(points.some(sample => Array.isArray(sample) &&
    typeof sample[0] === 'number' && typeof sample[1] === 'number' &&
    Math.abs(sample[0] * 390 - 298) < 2 && Math.abs(sample[1] * 844 - 415) < 2)).toBe(false);
  await cdp.detach();
});
