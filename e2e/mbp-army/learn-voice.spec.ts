// Learn surface Talk (DA-010, #552): a topic spoken on the live z0live call comes back as cards.
// Actual Expo web UI -> authenticated real bridge -> fixture z0live HTTP broker + fixture ACP agent.
// Proves browser state and transport only, never Android audio or native WebRTC (device check).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, pair } from './fixtures';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from './fixture-z0live-broker';

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({ identity: true, generatedUI: true, env: { DASH_NATIVE_VOICE: '1', DASH_Z0LIVE_BROKER: voiceBroker.origin, DASH_ARMY_VOICE_WEB: '1' } });
  },
});
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('learn: Talk turns a topic spoken on live z0live voice into Learn cards', async ({ page, bridge, voiceBroker }, info) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, '__dashVoiceArmy', { value: { ...tokens, identity: { credentialId: 'cred_armylearn0001' } }, configurable: true });
    // What the scripted web peer "hears" the owner say.
    Object.defineProperty(window, '__dashVoiceSay', { value: 'ARMY spoken topic black holes', configurable: true });
  }, { dash, z0live });

  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ hasText: 'ARMY native fixture' });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByTestId('chat-window-pill').click({ noWaitAfter: true });
  await page.getByTestId('spen-mode-pill').last().click({ noWaitAfter: true });
  const panel = page.getByTestId('mode-surface-learn');
  await expect(panel).toBeVisible();

  await page.getByRole('button', { name: 'Talk topics with live voice', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Stop talking topics', exact: true })).toBeVisible();
  // The live call really starts through the broker, and the spoken words become the topic.
  await expect.poll(() => voiceBroker.calls().some(call => call.method === 'POST' && call.path === '/v1/realtime/session'), { timeout: 20000 }).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Learn topic', exact: true })).toHaveValue('ARMY spoken topic black holes', { timeout: 20000 });
  await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8').catch(() => ''), { timeout: 20000 })
    .toContain('[Dash · Learn mode · explain] Topic: ARMY spoken topic black holes');
  await expect(page.getByLabel('card: ARMY Learn card', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('ARMY explains ARMY spoken topic black holes', { exact: true })).toBeVisible();
  // The hero orb stays out of Learn's way; the call's status lives in the header pill.
  await expect(page.getByTestId('voice-orb-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explain the topic as cards', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('learn-talk-cards.png') });

  // Stop listening ends the call Learn started.
  await page.getByRole('button', { name: 'Stop talking topics', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Talk topics with live voice', exact: true })).toBeVisible();
  await expect.poll(() => voiceBroker.calls().filter(call => /^\/v1\/sessions\/[^/]+\/end$/.test(call.path) && call.method === 'POST').length, { timeout: 15000 }).toBe(1);
  // One spoken topic, one Learn turn.
  const turns = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).split('\n').filter(line => line.includes('"event":"start"') && line.includes('Learn mode · explain'));
  expect(turns).toHaveLength(1);
});

test('learn: Talk without z0live identity says why in Learn and stops listening', async ({ page, bridge }) => {
  // No __dashVoiceArmy identity: the call cannot start, and Learn says so instead of pretending to listen.
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ hasText: 'ARMY native fixture' });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click({ noWaitAfter: true });
  await page.getByTestId('chat-window-pill').click({ noWaitAfter: true });
  await page.getByTestId('spen-mode-pill').last().click({ noWaitAfter: true });
  await expect(page.getByTestId('mode-surface-learn')).toBeVisible();
  await page.getByRole('button', { name: 'Talk topics with live voice', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('learn-note')).toContainText('Live voice unavailable:', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Talk topics with live voice', exact: true })).toBeVisible();
});
