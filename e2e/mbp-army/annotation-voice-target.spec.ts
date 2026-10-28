// Real Expo web -> real authenticated bridge -> scripted z0live peer/broker.
// Browser evidence only: the final spoken audio must also be checked on an S25.
import { test as base, expect, pair } from './fixtures';
import { stroke } from './annotation';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker, type VoiceBrokerCall } from './fixture-z0live-broker';

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

async function pairedVoice(page: import('playwright/test').Page, bridge: import('./fixtures').Bridge, broker: FixtureZ0liveBroker) {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  broker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, '__dashVoiceArmy', {
      value: { ...tokens, identity: { credentialId: 'cred_armyvoice_c22' } },
      configurable: true,
    });
    // A quiet peer: the only response.create should come from the ink turn's final.
    Object.defineProperty(window, '__dashVoiceSay', { value: '...', configurable: true });
  }, { dash, z0live });
  await pair(page, bridge);
}

const rows = (page: import('playwright/test').Page) =>
  page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]');
const hermes = (page: import('playwright/test').Page) =>
  rows(page).filter({ hasText: 'ARMY native fixture' });
const omp = (page: import('playwright/test').Page) =>
  rows(page).filter({ hasNotText: 'ARMY native fixture' });
const requests = (broker: FixtureZ0liveBroker, path: string) =>
  broker.calls().filter(call => call.method === 'POST' && call.path === path);
const ended = (broker: FixtureZ0liveBroker) =>
  broker.calls().filter(call => call.method === 'POST' && /^\/v1\/sessions\/[^/]+\/end$/.test(call.path));
const transcript = (call: VoiceBrokerCall) =>
  call.path === '/v1/events' && Array.isArray(call.body) && call.body.some((entry: unknown) =>
    typeof entry === 'object' && entry !== null && 'type' in entry &&
    entry.type === 'assistant_transcript' && 'text' in entry && entry.text === 'ARMY voice reply');

async function annotateHere(page: import('playwright/test').Page) {
  // The window's own Annotate action: with a live call the centred voice orb sits over the Options menu rows.
  await page.getByTestId('chat-annotate').click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
  await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
}

async function sendMarkedInk(page: import('playwright/test').Page, note: string) {
  await stroke(page);
  await page.getByRole('button', { name: 'Type a note', exact: true }).click({ noWaitAfter: true });
  await page.getByTestId('annotation-note').fill(note);
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click({ noWaitAfter: true });
}

test('annotation-voice-target: OMP chat beats a voice call bound to Hermes', async ({ page, bridge, voiceBroker }) => {
  await pairedVoice(page, bridge, voiceBroker);
  await expect(hermes(page)).toHaveCount(1);
  await hermes(page).click({ noWaitAfter: true });
  const hermesTitle = await page.getByTestId('chat-window-pill-title').innerText();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });

  // Start an explicit call while Hermes is the last attached conversation.
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Expand', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  await expect.poll(() => requests(voiceBroker, '/v1/realtime/session').length).toBe(1);
  // The full-screen Voice view stays up while the call runs; step back to the app, call still live.
  await page.getByRole('button', { name: 'Back to chat · call keeps going' }).click({ noWaitAfter: true });

  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(omp(page)).toHaveCount(1);
  await omp(page).click({ noWaitAfter: true });
  const ompTitle = await page.getByTestId('chat-window-pill-title').innerText();
  expect(ompTitle).not.toBe(hermesTitle);
  await annotateHere(page);
  const tray = page.getByTestId('annotation-tray');
  await expect(tray).toContainText('Sending to ' + ompTitle);
  await expect(tray).not.toContainText('Sending to ' + hermesTitle);

  await sendMarkedInk(page, 'C22_OMP_DESTINATION_PROOF');
  await expect(page.getByTestId('chat-window').getByText(/C22_OMP_DESTINATION_PROOF/).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  // End the call before reopening Hermes: the live orb is centred over the chat list.
  await page.getByRole('button', { name: 'End voice', exact: true }).click({ noWaitAfter: true });
  await hermes(page).click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window').getByText(/C22_OMP_DESTINATION_PROOF/)).toHaveCount(0);
  // OMP ink never generated a Hermes voice ask.
  expect(requests(voiceBroker, '/v1/tools/ask_z0')).toHaveLength(0);
});

test('annotation-voice-target: accepted Hermes ink stays live until spoken reply without cancel', async ({ page, bridge, voiceBroker }) => {
  await pairedVoice(page, bridge, voiceBroker);
  await expect(hermes(page)).toHaveCount(1);
  await hermes(page).click({ noWaitAfter: true });
  const title = await page.getByTestId('chat-window-pill-title').innerText();
  await annotateHere(page);
  await expect.poll(() => requests(voiceBroker, '/v1/realtime/session').length).toBe(1);
  await expect(page.getByTestId('annotation-tray')).toContainText('Sending to ' + title);
  await sendMarkedInk(page, 'C22_HERMES_SPOKEN_PROOF');
  await expect(page.getByTestId('chat-window').getByText(/C22_HERMES_SPOKEN_PROOF/).first()).toBeVisible({ timeout: 30000 });

  // C08's scripted peer emits this only after it receives response.create.
  // It must happen before the auto-started session's /end, and neither may cancel work.
  await expect.poll(() => voiceBroker.calls().filter(transcript).length, { timeout: 30000 }).toBe(1);
  expect(requests(voiceBroker, '/v1/tools/cancel_work')).toHaveLength(0);
  await expect.poll(() => ended(voiceBroker).length, { timeout: 30000 }).toBe(1);
  expect(requests(voiceBroker, '/v1/tools/cancel_work')).toHaveLength(0);
  const ordered = voiceBroker.calls();
  const playedAt = ordered.findIndex(transcript);
  const endedAt = ordered.findIndex(call => ended(voiceBroker).includes(call));
  expect(playedAt).toBeGreaterThanOrEqual(0);
  expect(endedAt).toBeGreaterThan(playedAt);
});
