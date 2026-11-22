import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, pair, web } from './fixtures';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from './fixture-z0live-broker';

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({ identity: true, env: {
      DASH_NATIVE_VOICE: '1', DASH_Z0LIVE_BROKER: voiceBroker.origin,
      DASH_ARMY_VOICE_WEB: '1', ARMY_TURBO_CLAUDE: '1',
    } });
  },
});

const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const url = web + '?turboRequest=1&liveRunning=' + sha;

test('Turbo speaks and sends one marked request to the paired Claude session from another screen', async ({ page, bridge, voiceBroker }, info) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  const speech = 'ARMY Turbo make this label clearer';
  voiceBroker.authorize(z0live);
  await page.addInitScript(tokens => {
    Object.defineProperty(window, '__dashVoiceArmy', {
      value: { dash: tokens.dash, z0live: tokens.z0live, identity: { credentialId: 'cred_armyturbo' } },
    });
    Object.defineProperty(window, '__dashVoiceSay', { value: tokens.speech });
  }, { dash, z0live, speech });
  await pair(page, bridge, url);
  const rows = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]');
  await rows.filter({ hasText: 'ARMY native fixture' }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
  const turbo = rows.filter({ hasText: 'ARMY dash-turbo Claude' });
  await turbo.click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
  await page.getByRole('tab').nth(0).click();
  await page.getByTestId('turbo-served-build').click({ delay: 750, noWaitAfter: true });
  await expect(page.getByTestId('turbo-now-testing')).toHaveText('Now testing: aaaaaaa');
  await page.getByRole('button', { name: 'New Turbo request', exact: true }).click();
  await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
  const tray = page.getByTestId('annotation-tray');
  await expect(tray).toContainText('→ dash-turbo');
  await expect(tray).toContainText('1 spoken');
  await page.mouse.move(85, 415);
  await page.mouse.down();
  await page.mouse.move(260, 450, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-shape-type="draw"]')).toHaveCount(1);

  const fixtureInput = join(bridge.dir, 'army-turbo-prompt.jsonl');
  expect(await readFile(fixtureInput, 'utf8').catch(() => '')).toBe('');
  const image = page.waitForResponse(response => response.url().includes('/attachments?') &&
    response.request().headers()['content-type'] === 'image/png');
  const json = page.waitForRequest(request => request.url().includes('/attachments?') &&
    request.headers()['content-type'] === 'application/json');
  await page.getByRole('button', { name: 'Send Turbo request', exact: true }).click();
  expect((await image).ok()).toBe(true);
  expect((await json).postDataJSON()).toMatchObject({
    schema: 'dash.annotation.v1', screen: { route: 'Main' },
    strokes: [expect.objectContaining({ points: expect.any(Array) })],
    transcript: { text: expect.stringContaining(speech) },
  });
  await expect(tray).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => readFile(fixtureInput, 'utf8').catch(() => '')).toContain(speech);
  const evidence = (await readFile(fixtureInput, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(evidence).toMatchObject([{
    agent: 'claude', sessionId: '11111111-2222-4333-8444-555555555557',
    text: expect.stringContaining(speech),
    attachments: expect.arrayContaining([
      expect.objectContaining({ mimeType: 'image/png' }),
      expect.objectContaining({ mimeType: 'application/json' }),
    ]),
  }]);
  expect(voiceBroker.calls().filter(call => call.path.startsWith('/v1/tools/'))).toEqual([]);
  await page.screenshot({ path: info.outputPath('turbo-request-sent.png') });
});

test('Turbo reload reopens the current workspace instead of Orchestra', async ({ page, bridge }) => {
  await pair(page, bridge, url);
  await page.getByRole('tab').nth(0).click();
  await expect(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('turbo-served-build').click({ delay: 750, noWaitAfter: true });
  await page.getByRole('button', { name: 'Reload now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__dashReloads ?? 0)).toBe(1);
  // The web reload seam signals instead of destroying the document; boot a fresh JS runtime now.
  await page.goto(url.replace(sha, 'b'.repeat(40)), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('turbo-served-build')).toContainText('bbbbbbb');
});
