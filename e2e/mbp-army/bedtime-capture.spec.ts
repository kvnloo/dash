import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chatRow, composer } from './fixtures';

test.use({ timezoneId: 'UTC' });
test('bedtime saves the chat draft locally across reload until the owner sends it after wake', async ({ page, bridge }) => {
 const evening = new Date();
 evening.setUTCHours(21, 59, 0, 0);
 await page.clock.setFixedTime(evening);
 await openChat(page, bridge);

 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
 const toggle = page.getByRole('switch', { name: 'Bedtime capture only', exact: true });
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await chatRow(page).click();

 const chat = page.getByTestId('chat-window');
 const input = chat.getByRole('textbox', { name: 'Message', exact: true });
 const thought = 'ARMY_BEDTIME_THOUGHT';
 await input.fill(thought);
 await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
 await page.clock.setFixedTime(new Date(evening.getTime() + 60_000));
 await chat.getByRole('button', { name: 'Save for tomorrow', exact: true }).click();
 await expect(input).toHaveValue('');
 await expect(chat.getByRole('button', { name: 'Saved for tomorrow (1)', exact: true })).toBeVisible();
 const turns = () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
 });
 expect(await turns()).not.toContain(thought);

 await page.reload({ waitUntil: 'domcontentloaded' });
 if (!await chat.isVisible()) await chatRow(page).click();
 const notes = chat.getByRole('button', { name: 'Saved for tomorrow (1)', exact: true });
 await notes.click();
 await expect(chat.getByText(thought, { exact: true })).toBeVisible();
 await expect(chat.getByRole('button', { name: 'Save for tomorrow', exact: true })).toBeVisible();
 const morning = new Date(evening.getTime() + 24 * 3600_000);
 morning.setUTCHours(7, 0, 0, 0);
 await page.clock.setFixedTime(morning);
 expect(await turns()).not.toContain(thought);
 await chat.getByRole('button', { name: 'Copy thought to draft', exact: true }).click();
 await expect(input).toHaveValue(thought);
 expect(await turns()).not.toContain(thought);
 await chat.getByRole('button', { name: 'Send', exact: true }).click();
 await expect.poll(turns).toContain(thought);
});

test('bedtime saves an unassigned main composer thought without opening a chat', async ({ page, bridge }) => {
 const evening = new Date();
 evening.setUTCHours(22, 0, 0, 0);
 await page.clock.setFixedTime(evening);
 await openChat(page, bridge);
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
 const toggle = page.getByRole('switch', { name: 'Bedtime capture only', exact: true });
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 const attachedSearch = page.getByRole('button', { name: /search chats/i }).first();
 if (await attachedSearch.isVisible()) await attachedSearch.click();
 await composer(page).fill('ARMY_UNASSIGNED_THOUGHT');
 await page.getByRole('button', { name: 'Save for tomorrow', exact: true }).click();
 await expect(composer(page)).toHaveValue('');
 await page.getByRole('button', { name: 'Saved for tomorrow (1)', exact: true }).click();
 await expect(page.getByText('ARMY_UNASSIGNED_THOUGHT', { exact: true })).toBeVisible();
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
});
