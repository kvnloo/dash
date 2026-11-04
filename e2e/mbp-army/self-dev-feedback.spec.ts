import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair, openChat, chatRow, composer } from './fixtures';

// Real exported Expo UI -> paired Bun bridge -> deterministic ACP fixture.
// Feedback is a secondmate steer; the fixture does not create a public GitHub issue.
test('cold open shows Orchestra and a typed feedback steer keeps its named thread after reload', async ({ page, bridge }) => {
  await pair(page, bridge);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true', { timeout: 25000 });
  await expect(page.getByTestId('orchestra-graph')).toBeVisible({ timeout: 25000 });

  const note = 'ARMY_DASH29 Show the self-development loop status more clearly';
  await composer(page).fill(note);
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText('Dash feedback', { exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/ARMY_REPLY: You are the Dash secondmate/).first()).toBeVisible({ timeout: 20000 });

  const turns = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8');
  expect(turns).toContain('You are the Dash secondmate.');

  await page.getByRole('button', { name: 'Back', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane').getByText('Dash feedback', { exact: true })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane').getByText('Dash feedback', { exact: true })).toBeVisible();
});

test('chat row long press requires an explicit feedback choice before steering', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });

  const row = chatRow(page);
  const box = await row.boundingBox();
  if (!box) throw new Error('Owned chat row has no screen bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();

  const feedback = page.getByRole('button', { name: 'Send feedback about New chat', exact: true });
  await expect(feedback).toBeVisible();
  await expect(page.getByText('Dash feedback', { exact: true })).toHaveCount(0);
  await feedback.click({ noWaitAfter: true });
  await expect(page.getByText('Dash feedback', { exact: true })).toBeVisible();
  await expect(page.getByText(/ARMY_REPLY: You are the Dash secondmate/).first()).toBeVisible({ timeout: 20000 });
});

test('beta feedback opt-out leaves Main text as an unsent agent draft', async ({ page, bridge }) => {
  await pair(page, bridge);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click({ noWaitAfter: true });
  const feedback = page.getByRole('switch', { name: 'In-app feedback', exact: true });
  await expect(feedback).toHaveAttribute('aria-checked', 'true');
  await feedback.click({ noWaitAfter: true });
  await expect(feedback).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Back', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('tab').nth(2).click({ noWaitAfter: true });

  const message = 'ARMY_DASH29 ordinary agent prompt after opt-out';
  await composer(page).fill(message);
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  // The Main action opens a normal chat with a draft; it must not auto-send feedback.
  await expect(composer(page)).toHaveValue(message);
  await expect(page.getByText('Dash feedback', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText(/ARMY_REPLY: ARMY_DASH29 ordinary agent prompt after opt-out/).first()).toBeVisible({ timeout: 20000 });
});
