// DA-024: a z0live call attached to the open chat answers small talk from the fast lane in under
// 1 s and routes a task ask to the meta lane, and the routing trace says which lane answered.
// Real Expo web app + real authenticated bridge + loopback z0live broker with two fixture lanes.
// The model delays live in the broker (the boundary Dash talks to), never in the app. Proves the
// app's own share of the latency and its routing trace; never a real model, native audio or WebRTC.
import { writeFile } from 'node:fs/promises';
import { test as base, expect, pair } from './fixtures';
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from './fixture-z0live-broker';

/** A small fast model's first token on a warm connection; the meta lane is a long task. */
const FAST_FIRST_TOKEN_MS = 400;
const META_MS = 4000;
const BUDGET_MS = 1000;
/** Utter this long after a 1 Hz inbox poll, so the answer lands ~20 ms after the following one. */
const POLL_PHASE_MS = 700;
const SMALL_TALK = ["hey Dash, how's it going", 'nice, what are you up to', "thanks, that's all for now"];
const TASK = 'fix the failing bridge test in this session';

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use, info) => {
    const broker = await startFixtureZ0liveBroker({ lanes: { sessionsDir: info.outputPath('z0live'), fastFirstTokenMs: FAST_FIRST_TOKEN_MS, metaMs: META_MS } });
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use, info) => {
    await use({ identity: true, env: {
      DASH_NATIVE_VOICE: '1', DASH_Z0LIVE_BROKER: voiceBroker.origin, DASH_ARMY_VOICE_WEB: '1',
      // The bridge folds the broker's lane records from here into the Voice screen's lane timeline.
      DASH_Z0LIVE_SESSIONS: info.outputPath('z0live'),
    } });
  },
});

/** "412 ms" / "4.1 s" from the routing trace, as ms. */
function traceMs(text: string): number {
  const match = /(\d+(?:\.\d+)?) (ms|s)$/.exec(text);
  if (!match) return NaN;
  return match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]);
}

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('z0live fast lane answers three small-talk turns under 1 s, routes the task to the meta lane and traces both', async ({ page, bridge, voiceBroker }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: 'z0live', scope: 'z0live:voice' });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, '__dashVoiceArmy', { value: { ...tokens, identity: { credentialId: 'cred_armyfastlane1' } }, configurable: true });
    Object.defineProperty(window, '__dashVoiceScripted', { value: true, configurable: true });
  }, { dash, z0live });

  // Attach the call to the open Hermes chat, then enter the live call screen through the normal UI.
  await pair(page, bridge);
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ hasText: 'ARMY native fixture' });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Expand', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-caption')).toBeVisible();

  // In-page clocks only: Playwright round trips on a loaded host never count toward the budget.
  await page.evaluate(() => {
    const seen: { route: number[]; spoken: number[] } = { route: [], spoken: [] };
    Object.defineProperty(window, '__armyFastLane', { value: seen, configurable: true });
    const watch = () => {
      const now = performance.now();
      for (let i = 0; i < 8; i++) if (seen.route[i] === undefined && document.querySelector(`[data-testid="voice-route-${i}"]`)) seen.route[i] = now;
      // Spoken answers: the live caption's first words, or the transcript line, whichever paints first.
      const spoken = new Set((document.body.textContent ?? '').match(/FAST (hey|nice|thanks)|META done/g) ?? []).size;
      for (let i = seen.spoken.length; i < spoken; i++) seen.spoken[i] = now;
    };
    new MutationObserver(watch).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).click({ noWaitAfter: true });
  const pill = page.getByTestId('voice-phase');
  const transcript = page.getByTestId('voice-transcript');
  await expect(pill).toHaveAttribute('aria-label', 'Voice status: listening', { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__dashVoiceUtter')), { message: 'scripted peer is ready for turns' }).toBe('function');

  // Worst case for a polling client: speak each turn so the fast lane's answer is ready just after
  // Dash's 1 Hz inbox poll went by (answer ready ~= utterance + 900 ms transcript + 400 ms model).
  // A client that waits for its next 1 Hz poll then misses the budget every time, not by chance.
  const inboxPolls = () => voiceBroker.calls().filter(call => call.method === 'GET' && call.path.startsWith('/v1/inbox')).map(call => call.at ?? 0);
  const utterAfterPoll = async (text: string) => {
    const before = inboxPolls().length;
    await expect.poll(() => inboxPolls().length, { message: 'a 1 Hz inbox poll went by' }).toBeGreaterThan(before);
    const last = inboxPolls().at(-1) ?? Date.now();
    await page.waitForTimeout(Math.max(0, last + POLL_PHASE_MS - Date.now()));
    await page.evaluate(said => { const utter: unknown = Reflect.get(window, '__dashVoiceUtter'); if (typeof utter === 'function') utter(said); }, text);
  };

  const turns = [...SMALL_TALK, TASK];
  for (const [i, text] of turns.entries()) {
    await utterAfterPoll(text);
    await expect(page.getByTestId(`voice-route-${i}`), `turn ${i + 1} reached the routing trace`).toBeVisible({ timeout: 15000 });
    await expect(transcript, `turn ${i + 1} answer was spoken`).toContainText(i < 3 ? `FAST ${text}` : 'META done in session army-fixture-session', { timeout: 15000 });
    await expect(pill).toHaveAttribute('aria-label', 'Voice status: listening', { timeout: 15000 });
  }

  // The routing trace on the live call screen: which lane answered each turn, in order.
  await expect(page.getByTestId('voice-route')).toHaveAttribute('aria-label', /^Answered by: fast lane in \d+ ms, fast lane in \d+ ms, fast lane in \d+ ms, meta lane in \d+\.\d s$/);
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`voice-route-${i}`)).toHaveText(/fast \d+ ms$/);
  await expect(page.getByTestId('voice-route-3')).toHaveText(/meta \d+\.\d s$/);
  // Each spoken answer is tagged with its lane in the transcript.
  await expect(transcript).toContainText(`fast  FAST ${SMALL_TALK[2]}`);
  await expect(transcript).toContainText('meta  META done in session army-fixture-session');

  // The broker's side of the same trace: four asks, small talk to fast, the task to meta, all for the open chat.
  const routes = voiceBroker.routes();
  expect(routes.map(route => [route.question, route.lane])).toEqual([...SMALL_TALK.map(text => [text, 'fast']), [TASK, 'meta']]);
  for (const route of routes) expect(route.target.session, 'the call is attached to the open chat').toBe('army-fixture-session');
  expect(voiceBroker.calls().filter(call => call.method === 'POST' && call.path === '/v1/tools/ask_z0')).toHaveLength(4);

  // Budget: from the final transcript to the fast lane's first token in Dash, measured in the page.
  const clocks = await page.evaluate(() => {
    const seen: unknown = Reflect.get(window, '__armyFastLane');
    const mark = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? NaN;
    const list = (key: string): number[] => {
      const value: unknown = typeof seen === 'object' && seen !== null ? Reflect.get(seen, key) : [];
      return Array.isArray(value) ? value.map(Number) : [];
    };
    return { finals: [1, 2, 3, 4].map(n => mark(`dash-voice-final-${n}`)), stopped: [1, 2, 3, 4].map(n => mark(`dash-voice-speech-stopped-${n}`)), route: list('route'), spoken: list('spoken') };
  });
  const appTrace = await Promise.all(turns.map((_, i) => page.getByTestId(`voice-route-${i}`).innerText().then(traceMs)));
  const rows = turns.map((text, i) => ({
    turn: i + 1, text, lane: routes[i]?.lane,
    firstTokenMs: Math.round((clocks.route[i] ?? NaN) - (clocks.finals[i] ?? NaN)),
    appTraceMs: appTrace[i],
    brokerModelMs: (routes[i]?.readyAt ?? NaN) - (routes[i]?.askedAt ?? NaN),
    appPollWaitMs: (routes[i]?.fetchedAt ?? NaN) - (routes[i]?.readyAt ?? NaN),
    speechEndToFirstSpokenMs: Math.round((clocks.spoken[i] ?? NaN) - (clocks.stopped[i] ?? NaN)),
  }));
  await writeFile(info.outputPath('fast-lane-timings.json'), JSON.stringify(rows, null, 2));
  console.log('fast-lane timings ' + JSON.stringify(rows));
  for (const row of rows.slice(0, 3)) {
    expect(row.firstTokenMs, `turn ${row.turn}: fast-lane first token in Dash under ${BUDGET_MS} ms`).toBeLessThan(BUDGET_MS);
    expect(row.firstTokenMs, `turn ${row.turn}: includes the fixture model's own delay`).toBeGreaterThanOrEqual(FAST_FIRST_TOKEN_MS);
  }
  expect(rows[3]?.firstTokenMs, 'the meta lane is slower than the budget and still answers').toBeGreaterThanOrEqual(META_MS);

  // The lane timeline (bridge fold of the broker's lane records) shows both lanes and their handoffs.
  await expect(page.getByTestId('lane-timeline-summary-text')).toHaveText(/^2 lanes/, { timeout: 10000 });
  await page.getByTestId('lane-timeline-summary').click({ noWaitAfter: true });
  await expect(page.getByTestId('lane-name-fast')).toHaveText('Fast · army-fast-mini');
  await expect(page.getByTestId('lane-name-meta')).toHaveText('Meta · army-meta-large');
  await expect(page.getByTestId('lane-handoff-line-fast')).toHaveText(`↳ FAST ${SMALL_TALK[2]}`, { timeout: 10000 });
  await expect(page.getByTestId('lane-handoff-line-meta')).toHaveText('↳ META done in session army-fixture-session', { timeout: 10000 });
  await page.screenshot({ path: info.outputPath('fast-lane-trace.png') });

  await page.getByRole('button', { name: 'Stop voice in Dash', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Start voice in Dash', exact: true })).toBeVisible();
  await expect.poll(() => voiceBroker.calls().filter(call => /^\/v1\/sessions\/[^/]+\/end$/.test(call.path) && call.method === 'POST').length).toBe(1);
});
