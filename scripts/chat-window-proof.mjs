#!/usr/bin/env node
// Real mounted Expo web app: Chats list → chat window → close. Fixture data, no model turn.
// The keyboard case applies KeyboardDock's native style outputs to the real DOM; it is a layout
// regression, not evidence of an Android IME. Not device acceptance.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve('.chat-window-receipts');
await mkdir(out, { recursive: true });
const port = 8198;
const errors = [];
const cases = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let log = '', browser;
const expo = spawn('bun', ['x', 'expo', 'start', '--web', '--port', String(port)], { cwd: path.resolve('app'), detached: true, env: { ...process.env, CI: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_DEBUG_AUTONAV: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
expo.stdout.on('data', d => log += d); expo.stderr.on('data', d => log += d);

const box = async (page, testId) => page.getByTestId(testId).boundingBox();
const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// No vision model in this run: decode the real screenshot pixels in Chromium and require painted
// content (distinct colours, bright text pixels) inside a region instead of trusting the DOM alone.
async function paint(page, rect) {
  const clip = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async data => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const colours = new Set();
    let bright = 0, total = 0, lum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      lum += l; total++;
      if (l > 140) bright++;
      colours.add(((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4));
    }
    return { colours: colours.size, brightFraction: bright / total, meanLuminance: lum / total };
  }, png);
}

async function listScroll(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-testid="chats-pane"]');
    const scroller = pane && [...pane.querySelectorAll('div')].find(el => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
    return scroller ? { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight } : null;
  });
}

async function openRow(page, title) {
  await page.getByTestId('chats-pane').getByText(title, { exact: true }).first().click();
  await page.getByTestId('chat-window').waitFor({ state: 'visible' });
  const firstOpacity = await page.getByTestId('chat-window').evaluate(el => Number(getComputedStyle(el).opacity));
  await sleep(400); // > the 100–150 ms morph
  const settledOpacity = await page.getByTestId('chat-window').evaluate(el => Number(getComputedStyle(el).opacity));
  return { firstOpacity, settledOpacity };
}

async function pillSlot(page) {
  return page.evaluate(() => {
    const text = el => el ? { text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1, right: el.getBoundingClientRect().right } : null;
    const title = document.querySelector('[data-testid="chat-window-pill-title"]');
    const status = document.querySelector('[data-testid="chat-window-pill-status"]');
    const statusText = status ? [...status.querySelectorAll('div[dir="auto"]')].pop() : null;
    const t = text(title), s = text(statusText);
    const pill = document.querySelector('[data-testid="chat-window-pill"]').getBoundingClientRect();
    const sr = status?.getBoundingClientRect();
    return { title: t?.text, titleClipped: t?.clipped, status: s?.text ?? null, statusClipped: s?.clipped ?? false, statusInside: sr ? sr.left >= pill.left && sr.right <= pill.right + 0.5 : null };
  });
}

async function setup(browser, { width, height, side = 'right', reduce = false, tag }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'load', timeout: 180000 } /* readiness = __DASH_DEBUG__.ready below; networkidle flaked on second pages in the composed app */);
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 120000 });
  await page.evaluate(() => window.__DASH_DEBUG__.scenario('main-chats'));
  await page.evaluate(s => window.__DASH_DEBUG__.run({ action: 'setHandedness', side: s }), side);
  await page.getByTestId('chats-pane').waitFor({ state: 'attached' });
  await page.getByRole('tab').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]')[1]?.getAttribute('aria-selected') === 'true');
  await page.evaluate(() => document.fonts.ready);
  await sleep(700);
  return { context, page };
}

async function closeWindow(page) {
  await page.getByTestId('chat-window-close').click();
  await page.getByTestId('chat-window').waitFor({ state: 'detached' });
  await sleep(200);
}

try {
  let ready = false;
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {}
    await sleep(1000);
  }
  assert(ready, 'Metro becomes ready');
  browser = await chromium.launch({ headless: true });
  for (const [width, height, side, reduce = false] of [[360, 780, 'right'], [390, 844, 'right'], [412, 915, 'right'], [412, 915, 'left'], [390, 844, 'right', true]]) {
    const tag = `${width}-${side}${reduce ? '-reduced' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'load', timeout: 180000 } /* readiness = __DASH_DEBUG__.ready below; networkidle flaked on second pages in the composed app */);
    await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 120000 });
    await page.evaluate(() => window.__DASH_DEBUG__.scenario('main-chats'));
    await page.evaluate(s => window.__DASH_DEBUG__.run({ action: 'setHandedness', side: s }), side);
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setVoiceStateFixture', state: { phase: 'listening', muted: false, lines: [] } }));
    await page.getByTestId('chats-pane').waitFor({ state: 'attached' });
    await page.getByRole('tab').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]')[1]?.getAttribute('aria-selected') === 'true');
    await page.evaluate(() => document.fonts.ready);
    await sleep(700);

    // Scroll the underlying list so "exact scroll restored" is a real check, when it can scroll.
    const title = 'Make Dash great on the phone: reply into Hermes sessions, magic links and approvals';
    await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="chats-pane"]');
      const scroller = pane && [...pane.querySelectorAll('div')].find(el => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
      if (scroller) scroller.scrollTop = Math.min(37, scroller.scrollHeight - scroller.clientHeight);
    });
    await sleep(200);
    const scrollBefore = await listScroll(page);
    const tabBefore = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].findIndex(t => t.getAttribute('aria-selected') === 'true'));
    await page.screenshot({ path: path.join(out, `${tag}-0-list.png`) });

    const morph = await openRow(page, title);
    assert.equal(morph.settledOpacity, 1, 'window fully opaque after the morph');
    if (reduce) assert.equal(morph.firstOpacity, 1, 'reduced motion: no fade-in');
    const stateOpen = await page.evaluate(() => window.__DASH_DEBUG__.state());
    await page.screenshot({ path: path.join(out, `${tag}-1-window.png`) });
    // Long title truncates first; the reserved status slot stays whole and readable.
    const slot = await pillSlot(page);
    assert.equal(slot.status, 'listening', `voice state readable in its slot: ${JSON.stringify(slot)}`);
    assert(!slot.statusClipped && slot.titleClipped, `title truncates before status: ${JSON.stringify(slot)}`);
    // Sol's app-wide mic bar (the one Mute/Stop home) sits below the pill, never over it or the camera band.
    const bar = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="voice-mic-bar"]')?.getBoundingClientRect();
      const p = document.querySelector('[data-testid="chat-window-pill"]').getBoundingClientRect();
      return { barTop: b?.top ?? null, pillBottom: p.bottom, mutes: document.querySelectorAll('[aria-label="Mute microphone"]').length };
    });
    assert(bar.barTop !== null && bar.barTop >= bar.pillBottom - 0.5 && bar.mutes === 1, `mic bar below pill, one Mute: ${JSON.stringify(bar)}`);

    // Underlying workspace stays mounted and painted (transparent presentation), not reset.
    const underlying = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="chats-pane"]');
      let el = pane, hidden = false;
      while (el) { if (getComputedStyle(el).display === 'none') hidden = true; el = el.parentElement; }
      return { mounted: Boolean(pane), hidden };
    });
    assert(underlying.mounted && !underlying.hidden, `workspace retained under the window: ${JSON.stringify(underlying)}`);

    // Pill: safe-area fallback on web (no cut-out rect), inside the viewport, accessible.
    const pill = await box(page, 'chat-window-pill');
    assert(pill && pill.y >= 0 && pill.x >= 0 && pill.x + pill.width <= width + 0.5 && pill.height >= 27, `pill bounds ${JSON.stringify(pill)}`);
    assert(Math.abs(pill.x + pill.width / 2 - width / 2) < 1, 'pill centred');
    const pillLabel = await page.getByTestId('chat-window-pill').getAttribute('aria-label');
    assert(/voice listening/.test(pillLabel ?? ''), `pill reports the live voice fixture honestly: ${pillLabel}`);
    assert.equal(await page.getByRole('tab').count(), 0, 'full tab bar collapsed into the pill');

    // Identity badge in the dock, not the header; model unknown, session short id present.
    const badgeText = await page.getByTestId('chat-window-badge').innerText();
    const badgeLabel = await page.getByTestId('chat-window-badge').getAttribute('aria-label');
    assert(/model unknown/.test(badgeText), `badge says model unknown: ${badgeText}`);
    const clipped = await page.getByTestId('chat-window-badge').evaluate(el => [...el.querySelectorAll('div[dir="auto"]')].filter(t => t.scrollWidth > t.clientWidth + 1).map(t => t.textContent));
    assert.deepEqual(clipped, [], 'badge lines fit their width without layout ellipsis');
    assert(/session debug-cli/.test(badgeLabel ?? ''), `badge a11y carries the session: ${badgeLabel}`);
    const dock = await box(page, 'chat-window-dock');
    assert(dock && dock.y > height / 2, 'badge lives in the bottom dock');
    const pixels = { pill: await paint(page, pill), badgeRow: await paint(page, await box(page, 'chat-window-badge-row')), transcript: await paint(page, { x: 0, y: pill.y + pill.height + 8, width, height: Math.max(40, dock.y - pill.y - pill.height - 16) }) };
    assert(pixels.pill.colours >= 4 && pixels.pill.brightFraction > 0.005, `pill paints text: ${JSON.stringify(pixels.pill)}`);
    assert(pixels.badgeRow.colours >= 4 && pixels.badgeRow.brightFraction > 0.002, `badge row paints: ${JSON.stringify(pixels.badgeRow)}`);

    // X: thumb-side corner of the dock, ≥ 44 hit, clear of send/mic.
    const close = await box(page, 'chat-window-close');
    assert(close && close.width >= 44 && close.height >= 44, `close hit ${JSON.stringify(close)}`);
    if (side === 'right') assert(close.x + close.width >= width - 24, `close on the right: ${JSON.stringify(close)}`);
    else assert(close.x <= 24, `close on the left: ${JSON.stringify(close)}`);
    const controls = await box(page, 'composer-controls');
    assert(!overlaps(close, controls), 'X does not collide with the attach/mic/send row');

    // Full-width text above the action row.
    const field = await box(page, 'composer-field');
    const input = await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox();
    assert(input.width >= field.width * 0.9 && input.y + input.height <= controls.y + 1, 'text full width above actions');

    // Draft typed in the window.
    const draft = `draft survives window ${tag}`;
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(draft);

    // Options: one bottom menu with explicit current surface.
    const trigger = page.getByRole('button', { name: /^Options\. Current surface: Chat$/ });
    await trigger.click();
    await page.getByRole('button', { name: /^Surface, Current: Chat · switch to Live surface$/ }).waitFor();
    await page.screenshot({ path: path.join(out, `${tag}-2-options.png`) });
    const menuRows = await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].map(b => b.getAttribute('aria-label')).filter(l => /^(Surface|Thinking & tools|Thinking summaries|Annotate|Approvals|Harness),/.test(l ?? '')));
    await page.getByRole('button', { name: /^Close Options/ }).click();
    await sleep(200);

    // Identity Tree expands inside the same dock surface.
    await page.getByTestId('chat-window-badge').click();
    await page.getByTestId('chat-window-identity').waitFor({ state: 'visible' });
    const tree = await page.getByTestId('chat-window-identity').innerText();
    assert(/Lineage unavailable/.test(tree) && /Model change unavailable/.test(tree) && /debug-cli/.test(tree), `tree content: ${tree}`);
    await page.screenshot({ path: path.join(out, `${tag}-3-tree.png`) });
    await page.getByTestId('chat-window-badge').click();
    await page.getByTestId('chat-window-identity').waitFor({ state: 'detached' });

    // Keyboard: apply KeyboardDock's IME style outputs (translateY = -keyboard) to the real dock.
    const ime = await page.evaluate(async () => {
      let dock = document.querySelector('[data-testid="chat-window-dock"]').parentElement;
      dock.style.transform = 'translateY(-300px)';
      dock.style.paddingBottom = '0px';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = id => { const b = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom }; };
      return { dock: r('chat-window-dock'), close: r('chat-window-close'), controls: r('composer-controls'), field: r('composer-field'), viewport: innerHeight };
    });
    assert(ime.dock.bottom <= ime.viewport - 299, `dock rides above a 300px keyboard: ${JSON.stringify(ime)}`);
    assert(!overlaps(ime.close, ime.controls) && ime.close.bottom <= ime.field.y + 1, 'X stays above the composer with the keyboard up');
    await page.screenshot({ path: path.join(out, `${tag}-4-keyboard.png`) });
    await page.evaluate(() => { const dock = document.querySelector('[data-testid="chat-window-dock"]').parentElement; dock.style.transform = ''; dock.style.paddingBottom = ''; });

    // Close: workspace page, scroll, active chat and session unchanged; voice untouched.
    await closeWindow(page);
    const scrollAfter = await listScroll(page);
    const tabAfter = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].findIndex(t => t.getAttribute('aria-selected') === 'true'));
    const stateClosed = await page.evaluate(() => window.__DASH_DEBUG__.state());
    await page.screenshot({ path: path.join(out, `${tag}-5-closed.png`) });
    assert.equal(tabAfter, tabBefore, 'same workspace page after close');
    if (scrollBefore) assert.equal(scrollAfter?.top, scrollBefore.top, 'exact list scroll restored');
    assert.equal(stateClosed.activeId, stateOpen.activeId, 'same conversation after close');
    assert.equal(stateClosed.ui.voiceStateFixture?.phase, 'listening', 'voice state not stopped by closing');
    assert(await page.getByTestId('voice-mic-bar').isVisible(), 'mic bar (Mute/Stop) still shown after close');

    // Reopen: same session, draft retained.
    await openRow(page, title);
    const reopenedDraft = await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue();
    assert.equal(reopenedDraft, draft, 'draft retained across close/reopen');
    const badgeAgain = await page.getByTestId('chat-window-badge').getAttribute('aria-label');
    assert.equal(badgeAgain, badgeLabel, 'same identity before/after');
    await closeWindow(page);

    cases.push({ tag, width, height, side, scrollBefore, scrollAfter, tabBefore, tabAfter, activeId: stateOpen.activeId, morph, pill, pillLabel, slot, pixels, badgeText, badgeLabel, close, controls, menuRows, ime, reopenedDraft });
    await context.close();
  }

  // SYNTHETIC cut-out + host-reading fixtures (debug-only), proving the native path's rendering.
  for (const [width, height] of [[412, 915], [320, 700]]) {
    const tag = `${width}-cutout`;
    const { context, page } = await setup(browser, { width, height, tag });
    const hole = { x: width / 2 - 13.715, y: 8, width: 27.43, height: 27.43 };
    await page.evaluate(r => window.__DASH_DEBUG__.run({ action: 'setCutoutFixture', reading: r }), { supported: true, rects: [hole], windowWidth: width, windowHeight: height, safeInsetTop: 35.43, rotation: 0 });
    // A reading for a different session must NOT label this chat.
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setHostSessionFixture', reading: { sessionId: 'someone-else', model: 'wrong-model', provider: 'wrong' } }));
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setVoiceStateFixture', state: { phase: 'speaking', muted: false, lines: [] } }));
    await openRow(page, 'Make Dash great on the phone: reply into Hermes sessions, magic links and approvals');
    const wrong = await page.getByTestId('chat-window-badge').innerText();
    assert(/model unknown/.test(wrong) && !/wrong-model/.test(wrong), `foreign session reading ignored: ${wrong}`);
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setHostSessionFixture', reading: { sessionId: 'debug-cli', model: 'claude-opus-5-5', provider: 'anthropic', parentSessionId: 'root-0001' } }));
    await sleep(300);
    const geometry = await page.evaluate(() => {
      const r = id => { const b = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null; };
      const path = document.querySelector('[data-testid="chat-window-pill-shape"] path');
      return { pill: r('chat-window-pill'), hole: r('chat-window-pill-hole'), fillRule: path?.getAttribute('fill-rule') ?? null };
    });
    assert(geometry.hole && geometry.fillRule === 'evenodd', `cut-out pill shape: ${JSON.stringify(geometry)}`);
    assert(Math.abs(geometry.hole.x + geometry.hole.width / 2 - width / 2) <= 1, `hole spacer centred on the camera: ${JSON.stringify(geometry)}`);
    assert(geometry.pill.y < hole.y && geometry.pill.y + geometry.pill.height > hole.y + hole.height, 'pill wraps the camera vertically');
    // The lens area is unpainted: it matches the window background outside the pill, not the pill fill.
    const lens = await paint(page, { x: width / 2 - 4, y: hole.y + hole.height / 2 - 4, width: 8, height: 8 });
    const body = await paint(page, { x: geometry.pill.x + 4, y: hole.y + hole.height / 2 - 2, width: 4, height: 4 });
    const outside = await paint(page, { x: 2, y: hole.y + hole.height / 2 - 2, width: 4, height: 4 });
    assert(Math.abs(lens.meanLuminance - outside.meanLuminance) < 1 && Math.abs(lens.meanLuminance - body.meanLuminance) > 1,
      `camera gap unpainted: lens ${JSON.stringify(lens)} outside ${JSON.stringify(outside)} body ${JSON.stringify(body)}`);
    const slot = await pillSlot(page);
    assert(slot.status === 'speaking' && !slot.statusClipped && slot.statusInside, `cut-out status slot readable: ${JSON.stringify(slot)}`);
    const badge = await page.getByTestId('chat-window-badge').innerText();
    assert(/claude-opus-5-5/.test(badge) && (width < 360 || /anthropic · claude-opus-5-5/.test(badge)), `host-reported model shown: ${badge}`);
    assert(/model anthropic claude-opus-5-5, reported by host/.test(await page.getByTestId('chat-window-badge').getAttribute('aria-label') ?? ''), 'a11y carries provider + model');
    await page.getByTestId('chat-window-badge').click();
    const tree = await page.getByTestId('chat-window-identity').innerText();
    assert(/root-0001/.test(tree) && /Model reported by host for this session · checked \d\d:\d\d:\d\d/.test(tree), `lineage + freshness: ${tree}`);
    await page.screenshot({ path: path.join(out, `${tag}-pill-tree.png`) });
    await page.getByTestId('chat-window-badge').click();
    await page.screenshot({ path: path.join(out, `${tag}-window.png`) });
    await page.screenshot({ path: path.join(out, `${tag}-pill-zoom.png`), clip: { x: 0, y: 0, width, height: 80 } });
    cases.push({ tag, synthetic: 'cutout + host reading fixtures', geometry, lens, outside, body, slot, badge, tree });
    await context.close();
  }

  // Populated transcript with a SYNTHETIC recorded stream (no model turn): running tool +
  // streaming text, X-close and reopen mid-stream; the stream keeps going, nothing duplicates.
  for (const [width, height] of [[390, 844], [320, 700]]) {
    const tag = `${width}-streaming`;
    const { context, page } = await setup(browser, { width, height, tag });
    await openRow(page, 'Transcript navigation');
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setThinking', phase: 'tool' }));
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'uxOutput', text: 'SYNTHETIC STREAM chunk one. ' }));
    await sleep(400);
    const before = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="transcript-viewport"]');
      const scroller = viewport && [...viewport.querySelectorAll('div')].find(el => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
      const body = document.querySelector('[data-testid="chat-window"]').innerText;
      return { scrollable: Boolean(scroller), scrollHeight: scroller?.scrollHeight ?? 0, chunks: body.split('SYNTHETIC STREAM chunk one.').length - 1, prompts: body.split('Prompt 23:').length - 1, stops: document.querySelectorAll('[aria-label="Stop"]').length };
    });
    const slotBefore = await pillSlot(page);
    assert(before.scrollable && before.chunks === 1 && before.prompts >= 1, `populated transcript: ${JSON.stringify(before)}`);
    assert.equal(slotBefore.status, 'terminal', `running tool in the pill: ${JSON.stringify(slotBefore)}`);
    assert(before.stops <= 1, 'one Stop control at most');
    const draft = `draft while streaming ${tag}`;
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(draft);
    await page.screenshot({ path: path.join(out, `${tag}-1-open.png`) });
    await closeWindow(page);
    // The stream continues while the window is closed.
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'uxOutput', text: 'SYNTHETIC STREAM chunk two.' }));
    await page.screenshot({ path: path.join(out, `${tag}-2-closed.png`) });
    await openRow(page, 'Transcript navigation');
    const after = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="chat-window"]').innerText;
      return { one: body.split('SYNTHETIC STREAM chunk one.').length - 1, two: body.split('SYNTHETIC STREAM chunk two.').length - 1, prompts: body.split('Prompt 23:').length - 1, windows: document.querySelectorAll('[data-testid="chat-window"]').length, pills: document.querySelectorAll('[data-testid="chat-window-pill"]').length };
    });
    const slotAfter = await pillSlot(page);
    assert.deepEqual(after, { one: 1, two: 1, prompts: before.prompts, windows: 1, pills: 1 }, `stream continued once, single instances: ${JSON.stringify(after)}`);
    assert.equal(slotAfter.status, 'terminal', 'tool still running after close/reopen (not stopped)');
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), draft, 'draft retained mid-stream');
    await page.screenshot({ path: path.join(out, `${tag}-3-reopened.png`) });
    cases.push({ tag, synthetic: 'recorded fixture stream, not a model turn', before, slotBefore, after, slotAfter });
    await context.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ status: 'PASS', revision: process.env.DASH_PROOF_REVISION, cases, errors, scope: 'Real Expo web UI + fixture data; IME simulated via KeyboardDock style outputs; not native-device acceptance' }, null, 2));
} catch (e) {
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ status: 'FAIL', revision: process.env.DASH_PROOF_REVISION, error: String(e.stack ?? e), cases, errors }, null, 2));
  throw e;
} finally {
  await browser?.close();
  try { process.kill(-expo.pid, 'SIGTERM'); } catch {}
  await writeFile(path.join(out, 'expo.log'), log);
}
