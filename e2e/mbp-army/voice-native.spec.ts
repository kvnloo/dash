// DA-063 (#293, #108): Live voice is a native part of Dash. The main-bar mic starts the call in place (no Voice
// screen, no other app or window), the call starts in Dash's bubble, and leaving Dash and coming back
// resumes talking to the same chat. Actual Expo web UI -> authenticated real bridge -> fixture z0live broker.
// This proves browser state and transport only, never Android audio, native WebRTC or the S25 launcher.
import { test as base, expect, pair } from './fixtures';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker, type VoiceBrokerCall } from './fixture-z0live-broker';
import type { Page } from 'playwright/test';

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({ identity: true, env: { DASH_NATIVE_VOICE: '1', DASH_Z0LIVE_BROKER: voiceBroker.origin, DASH_ARMY_VOICE_WEB: '1', ARMY_PERSIST_SESSION: '1' } });
  },
});
if (process.platform === "darwin") test.use({ persistSession: false });
test.use({ viewport: { width: 390, height: 844 } });

/** What Android does to Dash when the owner leaves it or comes back: the document's visibility changes. */
async function setVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible ? 'visible' : 'hidden');
}
const sessions = (calls: VoiceBrokerCall[]) => calls.filter(call => call.method === 'POST' && call.path === '/v1/realtime/session');
const targetOf = (call: VoiceBrokerCall | undefined): unknown => {
  const body = call?.body;
  return typeof body === 'object' && body !== null && 'context' in body && typeof body.context === 'object' && body.context !== null && 'hermes_target' in body.context ? body.context.hermes_target : undefined;
};

test('main-bar mic starts Live voice inside Dash with no Voice screen and resumes on the same chat after leaving Dash', async ({ page, bridge, voiceBroker }, info) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, '__dashVoiceArmy', { value: { ...tokens, identity: { credentialId: 'cred_armyvoice0063' } }, configurable: true });
    Object.defineProperty(window, '__dashVoiceSay', { value: 'ARMY voice hello', configurable: true });
  }, { dash, z0live });
  await pair(page, bridge);
  // Attach the Hermes chat, then go back to Main, where the owner's main bar is.
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ hasText: 'ARMY native fixture' });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });

  // Choose Live on the main-bar mic (hold, slide up), then tap it, as the owner does: the call starts right here.
  const mic = page.getByRole('button', { name: 'Dictate', exact: true }).first();
  await expect(mic).toBeVisible();
  const box = await mic.boundingBox();
  if (!box) throw Error('Main mic has no hit target');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300); // MicButton opens its mode picker after 220 ms.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 72, { steps: 8 });
  await page.mouse.up();
  const liveMic = page.getByRole('button', { name: 'Live voice', exact: true }).first();
  await expect(liveMic).toBeVisible();
  const bubble = page.getByTestId('voice-orb-overlay');
  if (await bubble.count() === 0) await liveMic.click({ noWaitAfter: true });

  const expectListening = () => expect(bubble).toHaveAttribute('aria-label', 'Open voice focus · Listening', { timeout: 15000 });
  await expectListening();
  await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
  await expect(page.getByTestId('voice-caption')).toHaveCount(0);
  await expect(page.getByText('Dash voice', { exact: true })).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('main-mic-live-in-place-390.png') });

  const asks = () => voiceBroker.calls().filter(call => call.method === 'POST' && call.path === '/v1/tools/ask_z0');
  await expect.poll(() => asks().length, { message: 'the spoken question reached the chat through z0live' }).toBe(1);
  expect(asks()[0]?.body).toMatchObject({ arguments: { question: 'ARMY voice hello' } });
  expect(sessions(voiceBroker.calls())).toHaveLength(1);
  const target = targetOf(sessions(voiceBroker.calls())[0]);
  expect(target).toMatchObject({ session: 'army-fixture-session' });
  await expectListening();

  // Leave Dash: the mic pauses (Android gives a backgrounded app none) and says it will resume.
  await setVisible(page, false);
  await expect(page.getByTestId('voice-error')).toHaveText(/^Mic paused while Dash was in the background/, { timeout: 10000 });
  // Come back: the call resumes by itself, bound to the same chat.
  await setVisible(page, true);
  await expectListening();
  await expect.poll(() => sessions(voiceBroker.calls()).length, { message: 'a fresh realtime call after returning' }).toBe(2);
  expect(targetOf(sessions(voiceBroker.calls())[1])).toEqual(target);
  await expect.poll(() => asks().length, { message: 'the resumed call keeps talking to the chat' }).toBe(2);
  expect(asks()[1]?.body).toMatchObject({ arguments: { question: 'ARMY voice hello' } });
  await expect(page.getByTestId('voice-caption')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('resumed-after-return-390.png') });

  // During the call the main mic opens focus for the existing session.
  const callMic = page.getByRole('button', { name: /^Live call, (listening|hearing|thinking|speaking)\. Show voice orb$/ }).first();
  await expect(callMic).toBeVisible();
  await callMic.click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-focus-back')).toBeVisible();

  // End from focus and return. The mic taps straight into Live (its last mode).
  await page.getByTestId('voice-end').click({ noWaitAfter: true });
  await expect(bubble).toHaveCount(0);
  await expect.poll(() => voiceBroker.calls().filter(call => /^\/v1\/sessions\/[^/]+\/end$/.test(call.path) && call.method === 'POST').length).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Live voice', exact: true }).first().click({ noWaitAfter: true });
  await expectListening();
  expect(targetOf(sessions(voiceBroker.calls())[2])).toEqual(target);
  await expect(page.getByTestId('voice-caption')).toHaveCount(0);
  await bubble.click({ delay: 650 });
  await page.getByTestId('voice-bubble-menu').getByRole('button', { name: 'End', exact: true }).click();
  await expect(bubble).toHaveCount(0);

  // Ending is final: returning to Dash after an ended call does not start a new one.
  const before = sessions(voiceBroker.calls()).length;
  await setVisible(page, false);
  await setVisible(page, true);
  await page.waitForTimeout(1500);
  expect(sessions(voiceBroker.calls())).toHaveLength(before);
});
