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
  await sleep(400); // > the 100–150 ms morph
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
  for (const [width, height, side] of [[360, 780, 'right'], [390, 844, 'right'], [412, 915, 'right'], [412, 915, 'left']]) {
    const tag = `${width}-${side}`;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 120000 });
    await page.evaluate(() => window.__DASH_DEBUG__.scenario('main-chats'));
    await page.evaluate(s => window.__DASH_DEBUG__.run({ action: 'setHandedness', side: s }), side);
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setVoiceFixture', state: { live: true, sessionId: 'fixture', phase: 'listening', muted: false, updated: 0, transcript: [] } }));
    await page.getByTestId('chats-pane').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await sleep(500);

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

    await openRow(page, title);
    const stateOpen = await page.evaluate(() => window.__DASH_DEBUG__.state());
    await page.screenshot({ path: path.join(out, `${tag}-1-window.png`) });

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
    assert(/session debug-cli/.test(badgeLabel ?? ''), `badge a11y carries the session: ${badgeLabel}`);
    const dock = await box(page, 'chat-window-dock');
    assert(dock && dock.y > height / 2, 'badge lives in the bottom dock');

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
    assert.equal(stateClosed.ui.z0liveFixture?.live, true, 'live voice state not stopped by closing');

    // Reopen: same session, draft retained.
    await openRow(page, title);
    const reopenedDraft = await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue();
    assert.equal(reopenedDraft, draft, 'draft retained across close/reopen');
    const badgeAgain = await page.getByTestId('chat-window-badge').getAttribute('aria-label');
    assert.equal(badgeAgain, badgeLabel, 'same identity before/after');
    await closeWindow(page);

    cases.push({ tag, width, height, side, scrollBefore, scrollAfter, tabBefore, tabAfter, activeId: stateOpen.activeId, pill, pillLabel, badgeText, badgeLabel, close, controls, menuRows, ime, reopenedDraft });
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
