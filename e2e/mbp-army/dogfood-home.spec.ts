import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';

// DA-051 / dash#29: Dash opens on the dogfood home (the self-development loop) while in-app
// feedback is on. Typed and dictated notes there reach the agent as Dash secondmate feedback.
test.use({
  bridgeOptions: { pm: false, env: { DASH_STT_ENGINE: 'fixture' } },
  launchOptions: {
    args: [
      ...(process.env.ARMY_HEADED === '1' ? ['--ozone-platform=wayland'] : []),
      '--disable-dev-shm-usage',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

const home = (page: Page) => page.getByTestId('dogfood-home');
const heading = (page: Page, name: string) => page.getByRole('heading', { name: `${name} workspace`, exact: true });

async function agentTurns(bridge: Bridge): Promise<string[]> {
  const raw = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8').catch(() => '');
  const starts: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const row: unknown = JSON.parse(line);
    if (typeof row === 'object' && row !== null && 'event' in row && row.event === 'start' && 'text' in row && typeof row.text === 'string') starts.push(row.text);
  }
  return starts;
}

async function coldLaunch(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').nth(1).waitFor({ timeout: 60000 });
}

test('dogfood home: cold launch lands on the self-development loop and typed feedback reaches the secondmate', async ({ page, bridge, errors }, info) => {
  await pair(page, bridge);
  await coldLaunch(page);
  await expect(home(page)).toBeVisible();
  await expect(heading(page, 'Dogfood')).toBeVisible();
  await expect(page.getByText('SELF-DEVELOPMENT LOOP', { exact: true })).toBeVisible();
  // No workspace dot claims to be current while the home covers the pager.
  for (let i = 0; i < 3; i++) await expect(page.getByRole('tab').nth(i)).toHaveAttribute('aria-selected', 'false');
  await page.screenshot({ path: info.outputPath('cold-launch.png') });

  const before = (await agentTurns(bridge)).length;
  const field = page.getByRole('textbox', { name: 'Dash feedback', exact: true });
  await field.fill('ARMY dogfood: the chip covers the composer');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click({ noWaitAfter: true });
  await expect(field).toHaveValue('');
  // The loop stays on screen and shows the note moving to a reply from the agent.
  await expect(home(page)).toBeVisible();
  const list = page.getByTestId('dogfood-feedback-list');
  await expect(list.getByText('ARMY dogfood: the chip covers the composer', { exact: true })).toBeVisible();
  await expect(list.getByText('Dash replied', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await agentTurns(bridge)).slice(before)).toEqual([expect.stringMatching(/^You are the Dash secondmate\./)]);
  // The feedback thread is not a normal chat row, and the Main composer stays the Main composer.
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open the feedback thread', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByTestId('chat-window').getByText('ARMY dogfood: the chip covers the composer', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('feedback-list.png') });
  expect(errors.filter(error => error.startsWith('PAGEERROR'))).toEqual([]);
});

test('dogfood home: dictated feedback is sent as voice, tabs leave the home and the header returns to it', async ({ page, bridge, errors }) => {
  await pair(page, bridge);
  await coldLaunch(page);
  await expect(home(page)).toBeVisible();

  const before = (await agentTurns(bridge)).length;
  const field = page.getByRole('textbox', { name: 'Dash feedback', exact: true });
  await page.getByRole('button', { name: 'Dictate feedback', exact: true }).click({ noWaitAfter: true });
  await expect(home(page).getByText('Listening · tap Stop when finished', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(400); // Record real Chromium fake-microphone samples before stopping.
  await page.getByRole('button', { name: 'Stop feedback dictation', exact: true }).click({ noWaitAfter: true });
  await expect(field).toHaveValue('ARMY heard you', { timeout: 20000 });
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('dogfood-feedback-list').getByText('ARMY heard you', { exact: true })).toBeVisible();
  await expect.poll(async () => (await agentTurns(bridge)).slice(before)).toEqual([expect.stringMatching(/^You are the Dash secondmate\./)]);

  // Any workspace tab leaves the home; the header action brings it back.
  await page.getByRole('tab', { name: 'Chats', exact: true }).click({ noWaitAfter: true });
  await expect(home(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Chats', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await page.getByRole('button', { name: 'Dogfood feedback', exact: true }).click({ noWaitAfter: true });
  await expect(home(page)).toBeVisible();
  await page.getByRole('button', { name: 'Open Orchestra', exact: true }).click({ noWaitAfter: true });
  await expect(home(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Orchestra', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(errors.filter(error => error.startsWith('PAGEERROR'))).toEqual([]);
});

test('dogfood home: with in-app feedback off, cold launch opens the plain Orchestra workspace', async ({ page, bridge }) => {
  await pair(page, bridge);
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click({ noWaitAfter: true });
  const toggle = page.getByRole('switch', { name: 'In-app feedback', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click({ noWaitAfter: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(k => (localStorage.getItem(k) ?? '').includes('"inAppFeedback":false')))).toBe(true);
  await coldLaunch(page);
  await expect(heading(page, 'Orchestra')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Orchestra', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(home(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dogfood feedback', exact: true })).toHaveCount(0);
});
