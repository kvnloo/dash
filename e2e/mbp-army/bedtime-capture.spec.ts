import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chatRow, composer, pair } from './fixtures';

test.use({ timezoneId: 'UTC' });
test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});
test('bedtime saves the chat draft locally across reload until the owner sends it after wake', async ({ page, bridge }) => {
 const evening = new Date();
 evening.setUTCHours(21, 59, 0, 0);
 await openChat(page, bridge);
 await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
 await page.clock.setFixedTime(evening);
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

 await page.clock.setFixedTime(new Date());
 await page.reload({ waitUntil: 'domcontentloaded' });
 await page.getByRole('tab').nth(1).click();
 await chatRow(page).click();
 await page.clock.setFixedTime(new Date(evening.getTime() + 60_000));
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
 await pair(page, bridge);
 await page.clock.setFixedTime(evening);
 await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
 const toggle = page.getByRole('switch', { name: 'Bedtime capture only', exact: true });
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await composer(page).fill('ARMY_UNASSIGNED_THOUGHT');
 await page.getByRole('button', { name: 'Save for tomorrow', exact: true }).click();
 await expect(composer(page)).toHaveValue('');
 await page.getByRole('button', { name: 'Saved for tomorrow (1)', exact: true }).click();
 await expect(page.getByText('ARMY_UNASSIGNED_THOUGHT', { exact: true })).toBeVisible();
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
});

test('opted-in host sleep posture activates capture outside the device schedule', async ({ page, bridge }) => {
 const stateDir = join(bridge.dir, '.local', 'state', 'circadian');
 await mkdir(stateDir, { recursive: true });
 const now = Date.now();
 const at = (hours: number) => new Date(now + hours * 3600_000).toISOString();
 await writeFile(join(stateDir, 'posture.json'), JSON.stringify({
  generatedAt: at(0),
  state: {
   schema: 'dash.human_state/v1',
   anchors: { wakeAt: at(-16), freezeAt: at(-4), bedTarget: at(-1), nightModeAt: at(-3), wakeTarget: at(7) },
   lastActivityAt: null, disengagedUntil: null, quality: 'wearable',
  },
 }));
 await pair(page, bridge);
 const noon = new Date();
 noon.setUTCHours(12, 0, 0, 0);
 await page.clock.setFixedTime(noon);
 await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
 const schedule = page.getByRole('switch', { name: 'Bedtime capture only', exact: true });
 await schedule.click();
 await expect(schedule).toHaveAttribute('aria-checked', 'true');
 const posture = page.waitForResponse(response => new URL(response.url()).pathname === '/posture' && response.ok());
 await page.getByRole('switch', { name: 'Follow paired host sleep posture', exact: true }).click();
 await posture;
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await composer(page).fill('ARMY_HOST_SLEEP_THOUGHT');
 await page.getByRole('button', { name: 'Save for tomorrow', exact: true }).click();
 await expect(composer(page)).toHaveValue('');
 await expect(page.getByRole('button', { name: 'Saved for tomorrow (1)', exact: true })).toBeVisible();
});
