#!/usr/bin/env node
// Real Expo web render of the composer controls lane. The keyboard samples apply KeyboardDock's
// native style outputs to the DOM; they are layout regressions, not a real Android IME.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = path.join(root, '.composer-receipts', 'rendered');
const port = 8197;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const receipt = { host: process.env.HOSTNAME, revision: process.env.DASH_PROOF_REVISION ?? 'uncommitted', data: 'Debug fixture conversations (seed "paired"), not live data', ime: 'Simulated KeyboardDock translate on Expo web DOM; not a native keyboard', cases: [], errors: [] };
const DRAFT = 'Keep my draft\nand selection';
const PROBE = 'dock send probe';

async function ready(url) {
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(1000);
  }
  throw new Error('Expo did not become ready');
}
const visible = (page, role, name) => page.getByRole(role, { name, exact: typeof name === 'string' }).filter({ visible: true });
async function geometry(input) {
  return input.evaluate(el => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
    return { input: rect(el), field: rect(el.parentElement), controls: rect(el.nextElementSibling) };
  });
}
function assertFullWidth(g, where) {
  assert(g.input.width >= g.field.width * 0.9, `${where}: text uses the full composer width`);
  assert(g.input.bottom <= g.controls.y + 1, `${where}: actions sit below the text`);
}
async function keyboard(page, height) {
  // Mirror KeyboardDock's native outputs on the dock that owns the visible Message field.
  return page.evaluate(async height => {
    const input = [...document.querySelectorAll('[aria-label="Message"]')].find(el => el.getClientRects().length);
    let dock = input;
    while (dock.parentElement && dock.parentElement.getBoundingClientRect().height < window.innerHeight * 0.6) dock = dock.parentElement;
    dock.style.transform = height ? `translateY(${-height}px)` : '';
    // In Chat the transcript viewport shrinks with the keyboard, as KeyboardInsetView does natively.
    const nav = document.querySelector('[aria-label="Prompt navigator"]');
    let inset = nav?.getClientRects().length ? nav.parentElement : null;
    while (inset && !inset.nextElementSibling?.contains(input)) inset = inset.parentElement;
    if (inset) inset.style.paddingBottom = `${height}px`;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const r = input.getBoundingClientRect();
    return { inputBottom: r.bottom, inputTop: r.y };
  }, height);
}

const expo = spawn('bun', ['x', 'expo', 'start', '--web', '--port', String(port)], {
  cwd: path.join(root, 'app'), detached: true,
  env: { ...process.env, CI: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_DEBUG_AUTONAV: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let expoLog = '';
expo.stdout.on('data', d => { expoLog += d; });
expo.stderr.on('data', d => { expoLog += d; });
let browser;
let currentPage;
await mkdir(out, { recursive: true });
try {
  await ready(`http://127.0.0.1:${port}`);
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 412]) {
    for (const hand of ['right', 'left']) {
      const height = width === 390 ? 844 : 915;
      const tag = `${width}-${hand}`;
      const result = { width, hand, checks: [] };
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      currentPage = page;
      page.on('pageerror', e => receipt.errors.push(`${tag}: ${e.message}`));
      await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 180000 });
      await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 120000 });
      await page.evaluate(() => window.__DASH_DEBUG__.scenario('chat-streaming'));
      if (hand === 'left') {
        // The scenario seed resets settings, so choose handedness afterwards through the app's own control.
        await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Settings' }));
        await page.getByRole('radio', { name: 'Left handedness', exact: true }).click();
        await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Chat' }));
      }
      await page.evaluate(() => document.fonts.ready);
      const attachedId = (await page.evaluate(() => window.__DASH_DEBUG__.state())).activeId;
      assert(attachedId, 'scenario attaches a conversation');
      const input = visible(page, 'textbox', 'Message');
      await input.waitFor();
      await input.fill(DRAFT);
      await input.evaluate(el => el.setSelectionRange(5, 13));
      const chat = await geometry(input);
      assertFullWidth(chat, `${tag} chat`);
      result.chat = chat;

      // Agent controls live in the composer: harness, model, read-only speed.
      const controls = visible(page, 'button', /^Agent controls/);
      const box = await controls.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width && box.width >= 44 && box.height >= 44, `${tag}: agent control is contained and >=44px`);
      const sendBox = await page.getByRole('button', { name: /^(Send|Queue|Steer)/ }).filter({ visible: true }).last().boundingBox();
      result.handedness = { agent: box, send: sendBox };
      if (hand === 'left') assert(sendBox.x < width / 2, `${tag}: send moves to the left thumb`);
      else assert(sendBox.x > width / 2, `${tag}: send stays at the right thumb`);
      await page.screenshot({ path: path.join(out, `${tag}-chat-streaming.png`) });
      await controls.click();
      for (const row of [/^Harness, /, /^Model, /, /^Speed, unavailable · no token timing$/]) await visible(page, 'button', row).waitFor();
      const menuRows = [];
      for (const row of await page.getByRole('button', { name: /^(Harness|Model|Speed|Needs OK), / }).filter({ visible: true }).all()) {
        const r = await row.boundingBox();
        assert(r.x >= 0 && r.x + r.width <= width + 1, `${tag}: menu row inside viewport`);
        menuRows.push({ name: await row.getAttribute('aria-label'), rect: r });
      }
      assert.equal(await page.getByText(/tok\/s/).count(), 0, `${tag}: no fabricated token rate`);
      await sleep(500);
      // The open menu paints above the transcript: the topmost element at each row centre is inside that row.
      for (const { rect, name } of menuRows) {
        const top = await page.evaluate(({ x, y, name }) => document.elementFromPoint(x, y)?.closest(`[aria-label="${name}"]`) !== null, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, name });
        assert(top, `${tag}: ${name} is not covered`);
      }
      result.menuRows = menuRows;
      await page.screenshot({ path: path.join(out, `${tag}-agent-menu.png`) });
      await page.getByRole('button', { name: /^Close Agent controls/ }).click();
      assert.equal(await input.inputValue(), DRAFT, `${tag}: draft kept after menu`);
      assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [5, 13], `${tag}: selection kept after menu`);

      // Model picker: searchable, inspection never claims to change the session.
      await controls.click();
      await visible(page, 'button', /^Model, /).click();
      const search = visible(page, 'textbox', 'Search models');
      await search.waitFor();
      await search.fill('claude');
      assert((await page.locator('body').innerText()).includes('No model change has been sent'), `${tag}: model sheet states nothing was sent`);
      await page.screenshot({ path: path.join(out, `${tag}-model-search.png`) });
      await visible(page, 'button', 'Close model search').click();

      // Keyboard open: controls and full-width text stay above the raised dock.
      const raised = await keyboard(page, 320);
      assert(raised.inputBottom <= height - 320 + 1, `${tag}: text above simulated keyboard`);
      assertFullWidth(await geometry(input), `${tag} chat keyboard`);
      const raisedControls = await controls.boundingBox();
      assert(raisedControls.y >= 0 && raisedControls.y + raisedControls.height <= height - 320, `${tag}: agent control above simulated keyboard`);
      await page.screenshot({ path: path.join(out, `${tag}-chat-keyboard.png`) });
      await keyboard(page, 0);

      // Outside Chat: the attached dock keeps the same session and draft.
      await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Main' }));
      const attached = visible(page, 'button', /^Attached to /);
      await attached.waitFor();
      const dockInput = visible(page, 'textbox', 'Message');
      assert.equal(await dockInput.inputValue(), DRAFT, `${tag}: Chat draft is the dock draft`);
      const dock = await geometry(dockInput);
      assertFullWidth(dock, `${tag} dock`);
      const peek = await page.getByRole('button', { name: /^Open attached chat, / }).filter({ visible: true }).boundingBox();
      const tuck = visible(page, 'button', 'Tuck conversation peek');
      const peekBottom = (await tuck.count()) ? (await tuck.boundingBox()).y + 30 : peek.y + peek.height;
      assert(peekBottom - peek.y <= 150, `${tag}: peek stays compact (${Math.round(peekBottom - peek.y)}px)`);
      const body = await page.locator('body').innerText();
      assert(!/sourceId|debug|undefined|\[object/i.test(body.replace(/Debug/g, '')), `${tag}: no source/debug text in dock`);
      result.dock = dock; result.peekHeight = peekBottom - peek.y;
      await page.screenshot({ path: path.join(out, `${tag}-dock-peek.png`) });
      const raisedDock = await keyboard(page, 320);
      assert(raisedDock.inputBottom <= height - 320 + 1, `${tag}: dock text above simulated keyboard`);
      await page.screenshot({ path: path.join(out, `${tag}-dock-keyboard.png`) });
      await keyboard(page, 0);

      // Switch sheet and search never retarget by themselves.
      await attached.click();
      await page.getByText('Attached session', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, `${tag}-switcher.png`) });
      await visible(page, 'button', 'Cancel').click();
      await visible(page, 'button', 'Search without detaching').click();
      await visible(page, 'button', 'Return to attached conversation input').click();
      assert.equal((await page.evaluate(() => window.__DASH_DEBUG__.state())).activeId, attachedId, `${tag}: switcher/search kept the attached session`);

      // Send from outside Chat lands in the attached conversation.
      await dockInput.fill(PROBE);
      const send = page.getByRole('button', { name: /^(Send|Queue|Steer)/ }).filter({ visible: true }).last();
      result.sendLabel = await send.getAttribute('aria-label');
      await send.click();
      await sleep(300);
      assert.equal((await page.evaluate(() => window.__DASH_DEBUG__.state())).activeId, attachedId, `${tag}: send kept the attached session`);
      await page.screenshot({ path: path.join(out, `${tag}-dock-sent.png`) });
      assert((await page.getByRole('button', { name: 'Open full conversation', exact: true }).filter({ visible: true }).innerText()).includes(`you · ${PROBE}`), `${tag}: peek shows the sent turn`);
      await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Chat' }));
      await visible(page, 'textbox', 'Message').waitFor();
      assert.equal(await visible(page, 'textbox', 'Message').inputValue(), '', `${tag}: accepted send cleared the shared draft`);
      // A send during a streaming turn is queued on the attached conversation, shown collapsed in Chat.
      if (result.sendLabel === 'Queue') await page.getByRole('button', { name: /^\d+ queued$/ }).filter({ visible: true }).click();
      // Queued turns render as editable fields, so check field values as well as text.
      await page.waitForFunction(probe => document.body.innerText.includes(probe) || [...document.querySelectorAll('textarea,input')].some(el => el.value === probe), PROBE, { timeout: 10000 });
      assert.equal((await page.evaluate(() => window.__DASH_DEBUG__.state())).activeId, attachedId, `${tag}: Chat opened the same session`);
      await page.screenshot({ path: path.join(out, `${tag}-chat-after-dock-send.png`) });
      // Approvals in the composer are scoped to the attached session and are never decided here.
      const fixture = { id: 'fixture-attached', sessionId: 'fixture-session-1', harness: 'hermes', profileId: 'clean', profileName: 'clean', title: 'Fixture attached session', createdAt: 1, updatedAt: 2,
        messages: [{ id: 'fu', role: 'user', text: 'Fixture question', at: 1 }, { id: 'fa', role: 'assistant', text: 'Fixture reply', at: 2, state: 'done', turnId: 'ft', seq: 0 }] };
      assert.equal((await page.evaluate(c => window.__DASH_DEBUG__.run({ action: 'inputSnapshot', conversation: c }), fixture)).ok, true);
      assert.equal((await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'scopedGateFixture' }))).ok, true);
      await visible(page, 'button', 'Agent controls, 1 approvals pending').waitFor();
      await visible(page, 'button', 'Review approval before deciding').waitFor();
      await page.screenshot({ path: path.join(out, `${tag}-dock-approval.png`) });
      await visible(page, 'button', 'Not now, keep approval pending').click();
      assert.equal(await visible(page, 'button', 'Review approval before deciding').count(), 0, `${tag}: Not now hides the prompt`);
      await visible(page, 'button', 'Agent controls, 1 approvals pending').click();
      await visible(page, 'button', 'Needs OK, 1 pending').click();
      await page.getByText('Attached session proposal').filter({ visible: true }).first().waitFor();
      assert(await page.getByText('Other session proposal').filter({ visible: true }).count() >= 1, `${tag}: Approvals screen still lists every proposal`);
      assert.equal(await page.getByText(/^(Approved|Posted|Rejected)/).filter({ visible: true }).count(), 0, `${tag}: nothing was decided`);
      await page.screenshot({ path: path.join(out, `${tag}-approvals-opened.png`) });
      result.checks.push('full width chat/dock', 'agent menu contained', 'speed honest unavailable', 'draft+selection kept', 'model search read-only', 'keyboard raised', 'dock draft shared', 'compact peek', 'switch/search kept session', 'outside send targets attached chat', 'approval badge scoped, Not now and Needs OK never decide');
      receipt.cases.push(result);
      await context.close();
    }
  }
  assert.deepEqual(receipt.errors, []);
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL'; receipt.failure = String(error.stack ?? error);
  try { await currentPage?.screenshot({ path: path.join(out, 'failure.png') }); receipt.failureText = await currentPage?.locator('body').innerText(); } catch {}
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-expo.pid, 'SIGTERM'); } catch {}
  await writeFile(path.join(out, 'expo.log'), expoLog);
  await writeFile(path.join(out, 'proof.json'), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify({ status: receipt.status, cases: receipt.cases.length }));
