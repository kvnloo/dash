import { expect, openChat, web, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';

export async function openAnnotation(page: Page, bridge: Bridge, engine?: 'skia' | 'tldraw') {
  await openChat(page, bridge, engine ? `${web}?annotateEngine=${engine}` : web);
  await enterAnnotation(page);
}
export async function enterAnnotation(page: Page) {
  await page.getByRole('button', { name: 'Options. Current surface: Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Annotate, S Pen or finger', exact: true }).click();
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
}
export async function stroke(page: Page) {
  await page.mouse.move(80, 400);
  await page.mouse.down();
  await page.mouse.move(260, 440);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();
}

/** Trusted Chromium pointerType=pen contacts, each press/release within 280 ms. */
export async function penDoubleTap(page: Page): Promise<void> {
  const bounds = await page.getByTestId('annotation-overlay').first().boundingBox();
  if (!bounds) throw new Error('Annotation overlay is missing');
  const x = bounds.x + Math.min(320, bounds.width - 16);
  const y = bounds.y + Math.min(360, bounds.height - 16);
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let tap = 1; tap <= 2; tap++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: tap, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: tap, pointerType: 'pen' });
    }
  } finally {
    await cdp.detach();
  }
}
