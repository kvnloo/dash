import { expect, type Page } from 'playwright/test';

/**
 * Answer the next Dash confirmation. Since #389 every confirmDestructive (web and native) is the themed
 * DashDialogHost card (role=dialog), never window.confirm. Starts waiting immediately, so call it BEFORE the
 * click that raises the dialog, then await the result after. Resolves to `${title}\n\n${message}`, the same
 * text the old window.confirm carried, after pressing Cancel (accept=false) or the destructive action (accept=true).
 */
export async function answerNextDialog(page: Page, accept: boolean, timeout = 15000): Promise<string> {
  // The row action sheet is a role=dialog Modal too and may still be closing: pick the card that holds the confirm buttons.
  const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('dash-dialog-action-cancel') }).last();
  await expect(dialog).toBeVisible({ timeout });
  const title = (await dialog.getByRole('heading').first().innerText()).trim();
  const labels = await dialog.locator('[data-testid^="dash-dialog-action-"]').allInnerTexts();
  let body = (await dialog.innerText()).trim();
  if (body.startsWith(title)) body = body.slice(title.length);
  for (const label of [...labels].reverse()) { body = body.trimEnd(); if (body.endsWith(label.trim())) body = body.slice(0, body.length - label.trim().length); }
  const message = body.trim();
  const target = accept
    ? dialog.locator('[data-testid^="dash-dialog-action-action:"]')
    : dialog.getByTestId('dash-dialog-action-cancel');
  await target.click({ noWaitAfter: true });
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })).toHaveCount(0, { timeout });
  return message ? `${title}\n\n${message}` : title;
}
