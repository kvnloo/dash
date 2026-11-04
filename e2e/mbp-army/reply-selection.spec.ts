// O15: real Expo web UI -> authenticated Bun bridge -> stdio ACP fixture, no route mocks.
import { test, expect, openChat, composer, send } from './fixtures';
import type { Page } from 'playwright/test';

async function selectAgentMessage(page: Page, phrase: string) {
  const reply = page.getByText(new RegExp('ARMY_REPLY: ' + phrase)).first();
  await expect(reply).toBeVisible({ timeout: 20000 });
  // React Native Web owns long presses on the surrounding Pressable, not its Text descendants.
  // Target that real gesture surface to avoid triggering the browser's text selection.
  const trigger = page.getByTestId('reply-selection-trigger').filter({ has: reply }).first();
  await expect(trigger).toBeVisible();
  // Playwright hover scrolls the Pressable into the viewport before the pointer is held.
  // Match the 900 ms hold already proven by send-longpress.spec.ts.
  await trigger.hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  const selection = page.getByTestId('reply-selection-input');
  await expect(selection).toBeVisible();
  return selection;
}

function startedTurns(log: string): number {
  return log.split('\n').filter(line => /\bturn\.start\b/.test(line)).length;
}

test('reply selection adds only highlighted assistant text to unsent draft, preserving attachments', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, 'H149-alpha H149-beta');
  await expect(page.getByText(/ARMY_REPLY: H149-alpha H149-beta/).first()).toBeVisible({ timeout: 20000 });
  await composer(page).fill('Draft remains');

  // Use the real attachment chooser so the quote cannot clobber an unsent file.
  await page.getByRole('button', { name: 'Attach file', exact: true }).click({ noWaitAfter: true });
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Files', exact: true }).click({ noWaitAfter: true });
  await (await fileChooser).setFiles({
    name: 'h149-evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Keep this attachment with the quoted reply.\n'),
  });
  await expect(page.getByText('h149-evidence.txt', { exact: true })).toBeVisible();
  const before = startedTurns(bridge.logs());

  const selection = await selectAgentMessage(page, 'H149-alpha H149-beta');
  await selection.focus();
  await selection.press('ControlOrMeta+End');
  // Select just the final nine UTF-16 code units of the agent message.
  for (let i = 0; i < 'H149-beta'.length; i++) await selection.press('Shift+ArrowLeft');
  await expect(page.getByRole('button', { name: 'Reply to selection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reply to selection', exact: true }).click({ noWaitAfter: true });

  await expect(page.getByTestId('reply-selection-input')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Draft remains\n\n> H149-beta\n\n');
  await expect(page.getByText('h149-evidence.txt', { exact: true })).toBeVisible();
  expect(startedTurns(bridge.logs())).toBe(before);
});

test('cancel text selection leaves draft and bridge unchanged', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, 'H149-cancel-message');
  await expect(page.getByText(/ARMY_REPLY: H149-cancel-message/).first()).toBeVisible({ timeout: 20000 });
  await composer(page).fill('Original unsent draft');
  const before = startedTurns(bridge.logs());
  await selectAgentMessage(page, 'H149-cancel-message');
  await page.getByRole('button', { name: 'Cancel selection', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('reply-selection-input')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Original unsent draft');
  expect(startedTurns(bridge.logs())).toBe(before);
});
