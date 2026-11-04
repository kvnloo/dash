import { test, expect, openChat, send } from './fixtures';
import type { Locator, Page } from 'playwright/test';

// All decisions go through the rendered gesture surface, never an app store or HTTP mock.
async function drag(page: Page, surface: Locator, from: number, to: number): Promise<void> {
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error('Action chip has no on-screen bounds');
  const y = box.y + box.height * 0.62;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 14 });
  await page.mouse.up();
}

async function findActionChips(page: Page): Promise<Locator> {
  const list = page.getByTestId('lab-scroll');
  const block = page.getByTestId('lab-action-chip');
  for (let i = 0; i < 14 && await block.count() === 0; i += 1) {
    await list.hover();
    await page.mouse.wheel(0, 450);
  }
  await expect(block).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  return block;
}

async function openLab(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Component lab', exact: true }).click({ noWaitAfter: true });
  return findActionChips(page);
}

test('H-074: Do and Not now swipes leave visible completed receipts, Undo and reload keep the decision', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The fixture agent answers through the real authenticated bridge before using the in-app Lab.
  await openChat(page, bridge);
  await send(page, 'ARMY_H074 swipe completion probe');
  await expect(page.getByText(/ARMY_REPLY: ARMY_H074 swipe completion probe/).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });

  let block = await openLab(page);
  await block.getByRole('button', { name: 'Reset', exact: true }).click();
  let card = block.getByTestId('chip-surface-lab-card');
  let receipt = block.getByTestId('chip-completion-lab-card');

  await expect(receipt).toHaveCount(0);
  // An under-threshold drag cannot commit a gesture or create a false receipt.
  await drag(page, card, 0.35, 0.41);
  await expect(receipt).toHaveCount(0);

  await drag(page, card, 0.16, 0.84);
  await expect(receipt).toContainText('Done · completed');
  await expect(receipt.getByText('✓ Done · completed')).toHaveAttribute('aria-label', /Do completed/);
  // The five-second Undo begins at the actual decision, so activate it promptly.
  const undo = receipt.getByRole('button', { name: 'Undo decision', exact: true });
  await undo.click();
  await expect(receipt).toHaveCount(0);
  await drag(page, card, 0.84, 0.16);
  await expect(receipt).toContainText('Not now · completed');
  await expect(receipt.getByText('× Not now · completed')).toHaveAttribute('aria-label', /Not now completed/);
  await receipt.scrollIntoViewIfNeeded();
  await expect(receipt).toBeInViewport({ ratio: 0.9 });
  const undoBounds = await receipt.getByRole('button', { name: 'Undo decision', exact: true }).boundingBox();
  expect(undoBounds?.height).toBeGreaterThanOrEqual(44);

  // A completed chip is inert; re-swiping cannot silently change Not now into Do.
  await drag(page, card, 0.16, 0.84);
  await expect(receipt).toContainText('Not now · completed');
  // The five-second Undo window expires without clearing visible completion.
  await expect(receipt.getByRole('button', { name: 'Undo decision', exact: true })).toHaveCount(0, { timeout: 8000 });
  await expect(receipt).toContainText('Not now · completed');
  await page.screenshot({ path: info.outputPath('h074-not-now-completed.png') });

  // Cold web reload reads the real AsyncStorage-backed feedback, not a seeded store.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').nth(1).waitFor({ timeout: 30000 });
  block = await openLab(page);
  card = block.getByTestId('chip-surface-lab-card');
  receipt = block.getByTestId('chip-completion-lab-card');
  await expect(receipt).toContainText('Not now · completed');
  await expect(card).toHaveAttribute('aria-label', /Not now/);
  await expect(receipt.getByRole('button', { name: 'Undo decision', exact: true })).toHaveCount(0);
  await receipt.scrollIntoViewIfNeeded();
  await expect(receipt).toBeInViewport({ ratio: 0.9 });
  await page.setViewportSize({ width: 320, height: 700 });
  await receipt.scrollIntoViewIfNeeded();
  await expect(receipt).toBeInViewport({ ratio: 0.9 });
});
