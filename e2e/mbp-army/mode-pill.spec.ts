// Mode pill order (A0220 P3): Normal → Learn → Quick → Annotate. Annotate is last because its
// full-screen ink overlay covers the pill; the tray's Exit leaves it, always to Normal.
// One real Expo web app -> authenticated Bun bridge -> fixture ACP agent; visible controls only.
import { test, expect, openChat, web } from './fixtures';
import type { Page } from 'playwright/test';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const label = (page: Page) => page.getByTestId('spen-mode-label').last();
const pill = (page: Page) => page.getByTestId('spen-mode-pill').last();
const annotating = (page: Page) => page.getByLabel('Annotation mode on', { exact: true });

async function openPill(page: Page) {
  // In the chat window the camera pill expands the AppNav that owns the mode pill.
  await page.getByTestId('chat-window-pill').click({ noWaitAfter: true });
  await expect(pill(page)).toBeVisible();
}

test('mode pill cycles Normal → Learn → Quick → Annotate and Exit returns to Normal', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge, `${web}?annotateEngine=skia`);
  await openPill(page);
  await expect(label(page)).toHaveText('Normal');
  await expect(pill(page)).toHaveAttribute('aria-label', 'Mode: Normal. Switch to Learn');

  await pill(page).click({ noWaitAfter: true });
  await expect(label(page)).toHaveText('Learn');
  await expect(page.getByTestId('mode-surface-learn')).toBeVisible();
  await expect(pill(page)).toHaveAttribute('aria-label', 'Mode: Learn. Switch to Quick');

  await pill(page).click({ noWaitAfter: true });
  await expect(label(page)).toHaveText('Quick');
  await expect(page.getByTestId('mode-surface-quick')).toBeVisible();
  await expect(page.getByTestId('mode-surface-learn')).toHaveCount(0);
  await expect(pill(page)).toHaveAttribute('aria-label', 'Mode: Quick. Switch to Annotate');

  await pill(page).click({ noWaitAfter: true });
  await expect(annotating(page)).toBeVisible();
  await expect(page.getByTestId('mode-surface-quick')).toHaveCount(0);

  await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
  await expect(annotating(page)).toHaveCount(0);
  await expect(label(page)).toHaveText('Normal');
  await expect(page.getByTestId('mode-surface-learn')).toHaveCount(0);
  await expect(page.getByTestId('mode-surface-quick')).toHaveCount(0);
});

test('mode pill: Learn close chip returns to Normal; annotating from Quick still exits to Normal', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge, `${web}?annotateEngine=skia`);
  await openPill(page);

  await pill(page).click({ noWaitAfter: true });
  await expect(page.getByTestId('mode-surface-learn')).toBeVisible();
  await page.getByRole('button', { name: 'Close Learn mode', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('mode-surface-learn')).toHaveCount(0);
  await expect(label(page)).toHaveText('Normal');

  // Quick open, then the chat's own ✎ Annotate (a different entry than the pill).
  await pill(page).click({ noWaitAfter: true });
  await pill(page).click({ noWaitAfter: true });
  await expect(page.getByTestId('mode-surface-quick')).toBeVisible();
  await page.getByTestId('chat-annotate').click({ noWaitAfter: true });
  await expect(annotating(page)).toBeVisible();
  await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });
  await expect(annotating(page)).toHaveCount(0);
  await expect(page.getByTestId('mode-surface-quick'), 'Annotate replaced Quick; Exit does not reopen it').toHaveCount(0);
  await expect(label(page)).toHaveText('Normal');
});
