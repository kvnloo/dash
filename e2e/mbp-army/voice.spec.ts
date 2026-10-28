// Actual Expo web UI -> authenticated real bridge -> fixture z0live HTTP broker.
// This proves only browser state/transport, never Android audio or native WebRTC.
import { test as base, expect, pair, type Bridge } from './fixtures';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker, type VoiceBrokerCall } from './fixture-z0live-broker';
import type { Page } from 'playwright/test';

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
  await page.getByRole('button', { name: 'Expand', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-caption')).toBeVisible();

  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  const caption = page.getByTestId('voice-caption');
  const pill = page.getByTestId('voice-phase');
  for (const phase of ['connecting', 'listening', 'hearing', 'thinking', 'speaking', 'listening']) {
    await expect(pill, 'actual voice pill phase ' + phase)
      .toHaveAttribute('aria-label', 'Voice status: ' + phase, { timeout: 15000 });
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
  await expect(pill).toHaveAttribute('aria-label', 'Voice status: idle');
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


// These journeys run the actual Expo UI, real authenticated bridge and C08 loopback broker.
// Only the web peer is deterministic; native ICE recovery still requires device checks.
async function enterScriptedVoice(
  page: Page,
  bridge: Bridge,
  broker: FixtureZ0liveBroker,
  options: { noTranscript?: boolean; neverReady?: boolean } = {},
): Promise<void> {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  broker.authorize(z0live);
  await page.addInitScript((settings: {
    dash: string; z0live: string; noTranscript: boolean; neverReady: boolean;
  }) => {
    Object.defineProperty(window, '__dashVoiceArmy', {
      value: { dash: settings.dash, z0live: settings.z0live, identity: { credentialId: 'cred_armyvoice0021' } },
      configurable: true,
    });
    Object.defineProperty(window, '__dashVoiceNoTranscript', { value: settings.noTranscript, configurable: true });
    Object.defineProperty(window, '__dashVoiceNeverReady', { value: settings.neverReady, configurable: true });
  }, { dash, z0live, noTranscript: options.noTranscript === true, neverReady: options.neverReady === true });

  await pair(page, bridge);
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]')
    .filter({ hasText: 'ARMY native fixture' });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Expand', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-caption')).toBeVisible();
}
function isAssistantObservation(call: VoiceBrokerCall): boolean {
  return call.method === 'POST' && call.path === '/v1/events' &&
    Array.isArray(call.body) && call.body.some((item: unknown) =>
      typeof item === 'object' && item !== null && 'type' in item && item.type === 'assistant_transcript');
}

test('live voice survives assistant transcript broker 500 and returns to listening', async ({ page, bridge, voiceBroker }) => {
  const info: string[] = [];
  page.on('console', message => { if (message.type() === 'info') info.push(message.text()); });
  await enterScriptedVoice(page, bridge, voiceBroker);
  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-transcript')).toContainText('ARMY voice reply', { timeout: 15000 });
  await expect.poll(() => voiceBroker.calls().filter(isAssistantObservation).length,
    { message: 'broker received assistant transcript observation and returned 500' }).toBe(1);
  await expect(page.getByTestId('voice-phase'))
    .toHaveAttribute('aria-label', 'Voice status: listening', { timeout: 15000 });
  await expect.poll(() => info.filter(line => line.includes('[voice] transcription on')).length)
    .toBe(1);
  await expect.poll(() => info.some(line => line.includes('[voice] assistant_transcript observation failed')))
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Stop voice in Dash', exact: true })).toBeVisible();
  expect(voiceBroker.calls().filter(call => call.path === '/v1/tools/ask_z0')).toHaveLength(1);
  await page.getByRole('button', { name: 'Stop voice in Dash', exact: true }).click({ noWaitAfter: true });
});

test('live voice reports no transcript within nine seconds and stays connected', async ({ page, bridge, voiceBroker }) => {
  const info: string[] = [];
  page.on('console', message => { if (message.type() === 'info') info.push(message.text()); });
  await enterScriptedVoice(page, bridge, voiceBroker, { noTranscript: true });
  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('dash-voice-speech-stopped')[0]?.startTime ?? 0),
    { timeout: 8000, message: 'scripted peer emitted speech_stopped' }).toBeGreaterThan(0);
  await expect(page.getByTestId('voice-caption'))
    .toHaveText('Speech heard but no transcript - voice setup issue', { timeout: 9000 });
  const elapsed = await page.evaluate(() => performance.now() - (performance.getEntriesByName('dash-voice-speech-stopped')[0]?.startTime ?? 0));
  expect(elapsed, 'warning must be visible within 9 s of speech_stopped').toBeLessThan(9000);
  await expect(page.getByTestId('voice-phase'))
    .toHaveAttribute('aria-label', 'Voice status: listening. Speech heard but no transcript - voice setup issue');
  await expect(page.getByTestId('voice-phase'))
    .toContainText('Speech heard but no transcript - voice setup issue');
  await expect.poll(() => info.some(line => line.includes('[voice] no-transcript'))).toBe(true);
  expect(voiceBroker.calls().filter(call => call.path === '/v1/tools/ask_z0')).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Stop voice in Dash', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop voice in Dash', exact: true }).click({ noWaitAfter: true });
});

test('live voice connection times out from Start when peer never becomes ready', async ({ page, bridge, voiceBroker }) => {
  await enterScriptedVoice(page, bridge, voiceBroker, { neverReady: true });
  const started = Date.now();
  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-caption'))
    .toContainText('Voice connection timed out', { timeout: 21000 });
  expect(Date.now() - started, '20 s timeout must start before the SDP answer').toBeLessThan(21000);
  await expect(page.getByTestId('voice-error'))
    .toContainText('Voice connection timed out');
  expect(voiceBroker.calls().filter(call => call.path === '/v1/tools/ask_z0')).toHaveLength(0);
});
