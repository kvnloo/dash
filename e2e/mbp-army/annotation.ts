import { expect, openChat, web, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';

export async function openAnnotation(page: Page, bridge: Bridge, engine?: 'skia' | 'tldraw') {
  await openChat(page, bridge, engine ? `${web}?annotateEngine=${engine}` : web);
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
