// Actual Expo web UI -> authenticated real bridge -> fixture z0live HTTP broker.
// This proves only browser state/transport, never Android audio or native WebRTC.
import { test as base, expect, pair } from './fixtures';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from './fixture-z0live-broker';

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({
      identity: true,
      env: {
        DASH_NATIVE_VOICE: '1',
        DASH_Z0LIVE_BROKER: voiceBroker.origin,
        DASH_ARMY_VOICE_WEB: '1',
      },
    });
  },
});

test('live voice moves connecting listening hearing thinking speaking listening and ends cleanly', async ({ page, bridge, voiceBroker }) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    // Test-only identity metadata: leave the paired legacy WebSocket alone.
    Object.defineProperty(window, '__dashVoiceArmy', {
      value: { ...tokens, identity: { credentialId: 'cred_armyvoice0001' } },
      configurable: true,
    });
    Object.defineProperty(window, '__dashVoiceSay', {
      value: 'ARMY voice hello',
      configurable: true,
    });
  }, { dash, z0live });

  await pair(page, bridge);
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]')
    .filter({ hasText: 'ARMY native fixture' });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  // Keep the attached Hermes target, but enter voice through the normal Main UI.
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Voice input', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-caption')).toBeVisible();

  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  const caption = page.getByTestId('voice-caption');
  for (const phase of ['connecting', 'listening', 'hearing', 'thinking', 'speaking', 'listening']) {
    await expect(caption, 'actual voice phase ' + phase).toContainText(phase, { timeout: 15000 });
  }

  const asks = () => voiceBroker.calls().filter(call =>
    call.method === 'POST' && call.path === '/v1/tools/ask_z0');
  await expect.poll(() => asks().length, { message: 'exactly one durable voice ask_z0' }).toBe(1);
  expect(asks()[0]?.body).toMatchObject({
    session_id: expect.any(String),
    call_id: 'army-voice-item-1',
    arguments: { question: 'ARMY voice hello' },
  });
  await expect(page.getByTestId('voice-transcript')).toContainText('ARMY voice reply', { timeout: 15000 });

  await page.getByRole('button', { name: 'Mute', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  await expect(caption).toContainText('muted');
  await page.getByRole('button', { name: 'Unmute', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Stop voice in Dash', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Start voice in Dash', exact: true })).toBeVisible();
  await expect(caption).toContainText('Realtime voice inside Dash');
  const calls = () => voiceBroker.calls();
  await expect.poll(() => calls().filter(call => call.path === '/v1/tools/cancel_work' && call.method === 'POST').length)
    .toBe(1);
  await expect.poll(() => calls().filter(call => /^\/v1\/sessions\/[^/]+\/end$/.test(call.path) && call.method === 'POST').length)
    .toBe(1);
  expect(asks()).toHaveLength(1);
  expect(calls().filter(call => call.method === 'POST' && call.path === '/v1/realtime/session')).toHaveLength(1);
  expect(calls().filter(call => call.method === 'POST' && call.path === '/v1/fake/answer')).toHaveLength(1);
  expect(calls().filter(call => call.method !== 'OPTIONS').every(call => call.authorized)).toBe(true);
});
