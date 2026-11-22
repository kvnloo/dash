// DA-075: the Council card (port in meaning of Glide's councilPopup), opened from a chat and from the
// live-call (z0live) Voice screen. Real Expo web app + real authenticated bridge reading a recorded
// council run from its credential dir. The browser's speechSynthesis is replaced by a scripted
// recorder so each sentence's start and end are controlled; this proves the card, the orb view and
// the switch between them, never device audio or a real council.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, openChat, pair } from './fixtures';

const RUN = {
  schema: 'glide.council-run/v1',
  brief: 'ARMY council brief. Ship the card behind a toggle?',
  constraints: ['Keep text usable without audio.'],
  rounds: 2,
  seats: [
    { id: 'quill', name: 'Quill', family: 'Anthropic' },
    { id: 'vega', name: 'Vega', family: 'OpenAI' },
    { id: 'moss', name: 'Moss', family: 'Google' },
  ],
  events: [
    { type: 'turn', seat: 'quill', round: 1 }, { type: 'turn', seat: 'vega', round: 1 }, { type: 'turn', seat: 'moss', round: 1 },
    { type: 'turn', seat: 'quill', round: 2, cites: ['moss'] }, { type: 'turn', seat: 'vega', round: 2 }, { type: 'turn', seat: 'moss', round: 2 },
  ],
  verdicts: [
    { seat: 'quill', stance: 'agree', text: 'ARMY Quill ships it.' },
    { seat: 'vega', stance: 'agree', text: 'ARMY Vega ships it too.' },
    { seat: 'moss', stance: 'dissent', text: 'ARMY Moss wants text only.' },
  ],
  outcome: 'ARMY ship behind a toggle',
};

/** A scripted speechSynthesis: records every utterance; with `hold` each one ends only on release. */
async function scriptSpeech(page: Page) {
  await page.addInitScript(() => {
    type Utter = { text: string; onstart?: ((e: object) => void) | null; onend?: ((e: object) => void) | null };
    const said: string[] = [];
    const pending: (() => void)[] = [];
    const s: { said: string[]; cancels: number; hold: boolean; current: Utter | null; pending: (() => void)[] } = { said, cancels: 0, hold: true, current: null, pending };
    class Utterance { text: string; onstart = null; onend = null; onerror = null; onpause = null; onresume = null; onmark = null; onboundary = null; rate = 1; pitch = 1; volume = 1; lang = ''; voice = null; constructor(text?: string) { this.text = text ?? ''; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speaking: false, pending: false, paused: false, onvoiceschanged: null,
      getVoices: () => [], pause() {}, resume() {},
      speak(u: Utter) {
        s.said.push(u.text); s.current = u;
        setTimeout(() => {
          if (s.current !== u) return;
          u.onstart?.({});
          const finish = () => { if (s.current === u) { s.current = null; u.onend?.({}); } };
          if (s.hold) s.pending.push(finish); else setTimeout(finish, 150);
        }, 30);
      },
      cancel() { s.cancels += 1; const u = s.current; s.current = null; s.pending = []; u?.onend?.({}); },
    } });
    Object.defineProperty(window, '__armySpeech', { value: s, configurable: true });
  });
}
const speech = (page: Page) => page.evaluate(() => {
  const s: unknown = Reflect.get(window, '__armySpeech');
  const said = s && typeof s === 'object' && 'said' in s && Array.isArray(s.said) ? s.said.map(String) : [];
  const cancels = s && typeof s === 'object' && 'cancels' in s ? Number(s.cancels) : 0;
  return { said, cancels };
});
/** Ends the sentence being spoken, once the engine has actually started it. */
async function finishSentence(page: Page) {
  const started = () => {
    const s: unknown = Reflect.get(window, '__armySpeech');
    return Boolean(s && typeof s === 'object' && 'pending' in s && Array.isArray(s.pending) && s.pending.length > 0);
  };
  await page.waitForFunction(started);
  await page.evaluate(() => {
    const s: unknown = Reflect.get(window, '__armySpeech');
    if (s && typeof s === 'object' && 'pending' in s && Array.isArray(s.pending)) { const next: unknown = s.pending.shift(); if (typeof next === 'function') next(); }
  });
}
const unhold = (page: Page) => page.evaluate(() => {
  const s: unknown = Reflect.get(window, '__armySpeech');
  if (s && typeof s === 'object' && 'hold' in s && 'pending' in s && Array.isArray(s.pending)) { Reflect.set(s, 'hold', false); for (const next of s.pending.splice(0)) if (typeof next === 'function') next(); }
});

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('Council card from chat sends the brief to every seat, shows their reports and reads both aloud through the orb, switching back and forth', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await writeFile(join(bridge.dir, '.dash', 'council-run.json'), JSON.stringify(RUN));
  await scriptSpeech(page);
  await openChat(page, bridge);
  await page.getByRole('button', { name: 'Options. Current surface: Chat', exact: true }).click({ noWaitAfter: true });
  await page.getByTestId('composer-menu-row-council').click({ noWaitAfter: true });

  const card = page.getByTestId('council-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('COUNCIL · FROM THIS CHAT')).toBeVisible();
  await expect(page.getByTestId('council-source')).toHaveText('LIVE · THIS COMPUTER');
  await expect(page.getByTestId('council-brief')).toHaveText(RUN.brief);
  for (const seat of RUN.seats) await expect(page.getByTestId(`council-seat-state-${seat.id}`)).toHaveText('WAITING');
  await expect(page.getByTestId('council-report')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('council-seated.png') });

  await page.getByRole('switch', { name: 'Read aloud' }).click({ noWaitAfter: true });
  await expect(page.getByRole('switch', { name: 'Read aloud' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Convene council', exact: true }).click({ noWaitAfter: true });

  // The brief is written, then read aloud: the orb replaces the card only once speech has started.
  const orb = page.getByTestId('council-orb-view');
  await expect(orb).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('council-caption')).toHaveText('ARMY council brief.');
  await page.screenshot({ path: info.outputPath('council-orb-brief.png') });

  // Any tap returns to the card and cancels that sentence; the card keeps the place.
  await orb.click({ noWaitAfter: true });
  await expect(card).toBeVisible();
  await expect(orb).toHaveCount(0);
  await expect.poll(async () => (await speech(page)).cancels).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('council-brief')).toHaveText(RUN.brief);
  const resume = page.getByTestId('council-resume');
  await expect(resume).toHaveText('Back to the orb · resume the brief (1/3)');
  await page.screenshot({ path: info.outputPath('council-returned.png') });

  // And back to the orb: the interrupted sentence is read again, then the rest in order.
  await resume.click({ noWaitAfter: true });
  await expect(orb).toBeVisible();
  await expect(page.getByTestId('council-caption')).toHaveText('ARMY council brief.');
  await finishSentence(page);
  await expect(page.getByTestId('council-caption')).toHaveText('Ship the card behind a toggle?');
  await finishSentence(page);
  await expect(page.getByTestId('council-caption')).toHaveText('Keep text usable without audio.');
  await finishSentence(page);

  // The card returns and the recorded turns drive each seat until every seat has reported.
  await expect(card).toBeVisible();
  await expect(page.getByTestId('council-seat-state-quill')).toHaveText(/^RECEIVED · (THINKING|DRAFTING)$/, { timeout: 15000 });
  await page.screenshot({ path: info.outputPath('council-working.png') });
  for (const seat of RUN.seats) await expect(page.getByTestId(`council-seat-state-${seat.id}`)).toHaveText('RECEIVED · DONE', { timeout: 20000 });

  // The completed report is read aloud through the orb as well.
  await expect(orb).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('council-caption')).toHaveText('Verdict.');
  await page.screenshot({ path: info.outputPath('council-orb-report.png') });
  await unhold(page);
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('council-verdict')).toContainText('ARMY ship behind a toggle');
  await expect(page.getByTestId('council-verdict')).toContainText('2 of 3 agree · 1 dissent');
  await expect(page.getByTestId('council-clause-agreements')).toContainText('Quill: ARMY Quill ships it. Vega: ARMY Vega ships it too.');
  await expect(page.getByTestId('council-clause-dissent')).toContainText('Moss: ARMY Moss wants text only.');
  await expect(page.getByTestId('council-clause-abstentions')).toContainText('None recorded.');
  await expect(page.getByTestId('council-clause-receipts')).toContainText('Round 2: Quill cited Moss.');
  await expect(page.getByTestId('council-seat-moss')).toHaveAttribute('aria-label', 'Moss, Google, RECEIVED · DONE, dissent');
  const { said } = await speech(page);
  expect(said.slice(0, 5)).toEqual(['ARMY council brief.', 'ARMY council brief.', 'Ship the card behind a toggle?', 'Keep text usable without audio.', 'Verdict.']);
  expect(said).toContain('Receipts.');
  await page.getByTestId('council-report').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('council-report.png') });

  await page.getByRole('button', { name: 'Close council', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('council-modal')).toHaveCount(0);
  await expect(page.getByTestId('chat-window')).toBeVisible();
});

test('Council card from the live-call Voice screen shows the labelled demo run, reads the report aloud on request and mute stops it', async ({ page, bridge }, info) => {
  // S25 Ultra web size, as in working-indicator.spec.ts; the device screenshot itself stays a device check.
  await page.setViewportSize({ width: 480, height: 1040 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scriptSpeech(page);
  await pair(page, bridge);
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Expand', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Open the council card', exact: true }).click({ noWaitAfter: true });

  const card = page.getByTestId('council-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('COUNCIL · FROM THE LIVE CALL')).toBeVisible();
  // No run recorded on this computer: the demo is labelled, never passed off as live.
  await expect(page.getByTestId('council-source')).toHaveText('DEMO');
  await expect(page.getByTestId('council-status')).toHaveText('no council run recorded on this computer; showing the demo run.');

  // Reduced motion: convening shows the finished exchange at once, and nothing is spoken unasked.
  await page.getByRole('button', { name: 'Convene council', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('council-clause-verdict')).toContainText('Offer read aloud as an opt-in');
  for (const id of ['argon', 'astra', 'fable']) await expect(page.getByTestId(`council-seat-state-${id}`)).toHaveText('RECEIVED · DONE');
  expect((await speech(page)).said).toEqual([]);
  await page.screenshot({ path: info.outputPath('council-s25-demo-report.png') });

  // Read aloud after the fact reads the report through the orb; a tap returns, Mute ends it.
  await page.getByRole('switch', { name: 'Read aloud' }).click({ noWaitAfter: true });
  const orb = page.getByTestId('council-orb-view');
  await expect(orb).toBeVisible();
  await expect(page.getByTestId('council-caption')).toHaveText('Verdict.');
  await page.screenshot({ path: info.outputPath('council-s25-demo-orb.png') });
  await orb.click({ noWaitAfter: true });
  await expect(page.getByTestId('council-resume')).toBeVisible();
  await page.getByRole('switch', { name: 'Mute council' }).click({ noWaitAfter: true });
  await expect(page.getByRole('switch', { name: 'Mute council' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('council-resume')).toHaveCount(0);
  await expect(orb).toHaveCount(0);
  expect((await speech(page)).said).toEqual(['Verdict.']);

  await page.getByRole('button', { name: 'Close council', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('council-modal')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open the council card', exact: true })).toBeVisible();
});
