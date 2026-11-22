// DA-085: the New-agent sheet starts every harness the host reports (local CLIs and Cursor cloud)
// and every bot it can spawn (Hermes gateway profile bots, GrokBot). Spawning a Hermes bot, a
// Cursor cloud agent (fixture API server, never the real one) and GrokBot each yields a chat in Chats.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, createBridge, pair, composer, send, type Bridge } from './fixtures';
import { startCursorFixture, CURSOR_FIXTURE_KEY, type CursorFixture } from './fixture-cursor-cloud';
import type { Page } from 'playwright/test';

// Every catalog harness the bridge reports (bridge/src/harnesses.ts HARNESSES), local CLIs first.
const LOCAL = ['omp', 'codex', 'grok', 'claude', 'hermes', 'pi', 'fx'];
const BOT_PROFILE = 'armybot';
const REPO = 'https://github.com/army-fixture/dash-sandbox';

async function acpCalls(dir: string): Promise<Record<string, unknown>[]> {
 const text = await readFile(join(dir, 'army-acp-calls.jsonl'), 'utf8').catch(() => '');
 return text.split('\n').filter(Boolean).map((line): unknown => JSON.parse(line)).filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
}
async function openSheet(page: Page) {
 await page.getByRole('button', { name: 'New agent', exact: true }).first().click({ noWaitAfter: true });
 await expect(page.getByTestId('new-agent-sheet')).toBeVisible();
}
async function backToChats(page: Page) {
 await page.getByRole('button', { name: 'Back', exact: true }).click({ noWaitAfter: true });
 await expect(page.getByTestId('chats-pane')).toBeVisible();
}

test.afterEach(async ({ page }, info) => { if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') }); });

test('new-agent-every-harness: the New agent sheet lists every harness, Cursor cloud and bots, and spawns a Hermes bot, a Cursor cloud agent and GrokBot into Chats', async ({ page }, info) => {
 const cursor: CursorFixture = await startCursorFixture();
 let bridge: Bridge | undefined;
 try {
  bridge = await createBridge(true, { hermesProfiles: [BOT_PROFILE], hermesBots: [BOT_PROFILE], grok: true,
   env: { CURSOR_API_KEY: CURSOR_FIXTURE_KEY, DASH_CURSOR_API_URL: cursor.url, DASH_CURSOR_REPOSITORY: REPO, DASH_CURSOR_POLL_MS: '150' } });
  const b = bridge;
  await pair(page, b);

  // 1. The sheet: every catalog harness, the Cursor cloud harness, and the spawnable bots.
  await openSheet(page);
  const sheet = page.getByTestId('new-agent-sheet');
  const rowIds = () => sheet.locator('[data-testid^="new-agent-row-"]').evaluateAll(rows => rows.map(r => r.getAttribute('data-testid')));
  await expect.poll(rowIds, { timeout: 20000 }).toEqual(expect.arrayContaining([`new-agent-row-bot-hermes-bot:${BOT_PROFILE}`, 'new-agent-row-bot-grok-bot']));
  const ids = await rowIds();
  expect(ids.filter(id => id?.startsWith('new-agent-row-harness-'))).toEqual([...LOCAL, 'cursor-cloud'].map(id => `new-agent-row-harness-${id}`));
  await expect(page.getByTestId('new-agent-section-harnesses')).toContainText('Harnesses on');
  await expect(page.getByTestId('new-agent-section-cloud').getByTestId('new-agent-row-harness-cursor-cloud')).toContainText('Cursor Cloud');
  await expect(page.getByTestId('new-agent-section-bots')).toContainText(BOT_PROFILE);
  await expect(page.getByTestId('new-agent-section-bots')).toContainText('GrokBot');
  // Installed harnesses start; missing ones say so instead of failing after a tap.
  await expect(page.getByRole('button', { name: 'New OMP agent', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'New Cursor Cloud agent', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Pi, unavailable', exact: true })).toBeDisabled();
  await page.waitForTimeout(600); // let the fade-in settle for the evidence screenshot
  await page.screenshot({ path: info.outputPath('new-agent-sheet.png') });

  // 2. Hermes gateway profile bot: a new Hermes ACP chat in that profile's own home.
  await page.getByRole('button', { name: `New ${BOT_PROFILE} agent`, exact: true }).click({ noWaitAfter: true });
  await expect(composer(page)).toHaveAttribute('placeholder', /Hermes/);
  await send(page, 'ARMY hermes bot spawn');
  await expect(page.getByText('ARMY_REPLY: ARMY hermes bot spawn').first()).toBeVisible({ timeout: 30000 });
  expect(b.logs()).toMatch(new RegExp(`ws\\.chat .*harness=hermes .*profileId=hermes:${BOT_PROFILE}`));
  expect(b.logs()).toContain(`hermes.bot id=`);
  await expect.poll(async () => (await acpCalls(b.dir)).some(c => c.method === 'session/new' && typeof c.hermesHome === 'string' && c.hermesHome.endsWith(join('.hermes', 'profiles', BOT_PROFILE)))).toBe(true);
  await backToChats(page);
  const chats = page.getByTestId('chats-pane');
  await expect(chats.locator('[data-testid^="chat-row-"]').filter({ hasText: 'ARMY hermes bot spawn' })).toHaveCount(1, { timeout: 20000 });

  // 3. Cursor cloud agent: launched over the (fixture) Cursor API on the configured repository.
  await openSheet(page);
  await page.getByRole('button', { name: 'New Cursor Cloud agent', exact: true }).click({ noWaitAfter: true });
  await expect(composer(page)).toHaveAttribute('placeholder', /Cursor Cloud/);
  await send(page, 'ARMY cursor cloud spawn');
  await expect(page.getByText('ARMY_CURSOR_REPLY: ARMY cursor cloud spawn').first()).toBeVisible({ timeout: 30000 });
  const launches = cursor.calls.filter(c => c.method === 'POST' && c.path === '/v0/agents');
  expect(launches).toHaveLength(1);
  expect(launches[0]?.authorized).toBe(true);
  expect(launches[0]?.body).toEqual({ prompt: { text: 'ARMY cursor cloud spawn' }, source: { repository: REPO } });
  expect(cursor.calls.every(c => c.authorized)).toBe(true);
  // A second message in the same chat is a follow-up to the same cloud agent, not a new agent.
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await send(page, 'ARMY cursor cloud follow up');
  await expect(page.getByText('ARMY_CURSOR_REPLY: ARMY cursor cloud follow up').first()).toBeVisible({ timeout: 30000 });
  expect(cursor.calls.filter(c => c.method === 'POST' && c.path === '/v0/agents')).toHaveLength(1);
  expect(cursor.calls.filter(c => c.method === 'POST' && c.path === '/v0/agents/bc_army_1/followup').map(c => c.body)).toEqual([{ prompt: { text: 'ARMY cursor cloud follow up' } }]);
  await backToChats(page);
  const cursorRow = chats.locator('[data-testid^="chat-row-"]').filter({ hasText: 'ARMY cursor cloud spawn' });
  await expect(cursorRow).toHaveCount(1, { timeout: 20000 });
  // The real key never reaches the phone: nothing the app received carries it.
  expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain(CURSOR_FIXTURE_KEY);

  // 4. GrokBot: a new Grok chat over Grok's ACP entrypoint.
  await openSheet(page);
  await page.getByRole('button', { name: 'New GrokBot agent', exact: true }).click({ noWaitAfter: true });
  await expect(composer(page)).toHaveAttribute('placeholder', /Grok/);
  await send(page, 'ARMY grokbot spawn');
  await expect(page.getByText('ARMY_REPLY: ARMY grokbot spawn').first()).toBeVisible({ timeout: 30000 });
  expect(b.logs()).toMatch(/ws\.chat .*harness=grok /);
  await expect.poll(async () => (await acpCalls(b.dir)).some(c => c.agent === 'grok' && c.method === 'session/new')).toBe(true);
  await backToChats(page);
  await expect(chats.locator('[data-testid^="chat-row-"]').filter({ hasText: 'ARMY grokbot spawn' })).toHaveCount(1, { timeout: 20000 });
  // All three spawned chats are in Chats at once.
  for (const text of ['ARMY hermes bot spawn', 'ARMY cursor cloud spawn', 'ARMY grokbot spawn']) await expect(chats.getByText(text, { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('chats-after-spawn.png') });
 } finally {
  if (bridge) { await writeFile(info.outputPath('bridge.log'), bridge.logs()); await bridge.dispose(); }
  await writeFile(info.outputPath('cursor-calls.json'), JSON.stringify(cursor.calls, null, 2));
  await cursor.stop();
 }
});
