import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Own headless browser only. Supply a debug-enabled Expo web export, never a phone URL.
const base = process.argv[2];
const out = process.argv[3];
assert(base && out, 'Usage: node scripts/lab-polish-proof.mjs URL OUTPUT_DIRECTORY');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' || (message.type() === 'warning' && message.text().includes('may be overwritten by a layout animation'))) errors.push(message.text()); });
const cdp = await context.newCDPSession(page);
const tile = () => page.getByTestId('gesture-playground').last();
const shot = name => page.screenshot({ path: path.join(out, `${name}.png`) });
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 0 }] });
async function point() { const b = await tile().boundingBox(); assert(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function taps(n) { const { x, y } = await point(); for (let i = 0; i < n; i++) { await touch('touchStart', x, y); await page.waitForTimeout(35); await touch('touchEnd'); if (i < n - 1) await page.waitForTimeout(70); } }
async function hold() { const p = await point(); await touch('touchStart', p.x, p.y); await page.waitForTimeout(500); assert.equal(await page.getByTestId('radial-wheel').count(), 1); return p; }
async function move(p, dx, dy) { for (let i = 1; i <= 6; i++) { await touch('touchMove', p.x + dx * i / 6, p.y + dy * i / 6); await page.waitForTimeout(32); } }
async function close() { await page.getByRole('button', { name: 'Close tile detail', exact: true }).click(); await page.getByTestId('tile-detail').waitFor({ state: 'detached' }); }
try {
  await page.goto(`${base}/lab`);
  await tile().waitFor(); await page.waitForTimeout(1000);
  await taps(1);
  const frames = [];
  let previous = 0;
  for (const ms of [40, 120, 210, 270, 400, 700]) {
    await page.waitForTimeout(ms - previous); previous = ms;
    frames.push({ ms, box: await page.getByTestId('tile-detail-morph').boundingBox() });
    await shot(`morph-${ms}`);
  }
  assert.equal(await page.getByTestId('tile-detail').count(), 1); await close(); checks.push({ single: true, frames });
  await taps(2); await page.waitForTimeout(400); assert.match(await tile().innerText(), /Pinned/);
  await taps(3); await page.waitForTimeout(400); assert.match(await tile().innerText(), /Copied/); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Tap opens detail. Double tap pins locally in this view. Triple tap copies this summary. Hold, slide and release selects a radial action; release in the centre cancels.'); checks.push({ doublePins: true, tripleCopies: true });
  let p = await point(); await touch('touchStart', p.x, p.y); await page.waitForTimeout(375); await shot('wheel-bloom-375'); await page.waitForTimeout(125); await shot('wheel-bloom-500');
  await move(p, 106, 0); await shot('wheel-selected'); await touch('touchEnd'); await page.waitForTimeout(300); assert.doesNotMatch(await tile().innerText(), /Pinned/);
  await hold(); await touch('touchEnd'); await page.waitForTimeout(300); assert.equal(await page.getByTestId('tile-detail').count(), 0); checks.push({ radialCommit: true, centreCancel: true });
  p = await point(); await touch('touchStart', p.x, p.y); await move(p, 0, -180); await touch('touchEnd'); await page.waitForTimeout(300);
  const scroll = await page.getByTestId('lab-scroll').evaluate(el => el.scrollTop); assert(scroll > 50); assert.equal(await page.getByTestId('radial-wheel').count(), 0); checks.push({ scrollFromTile: scroll });
  await page.getByTestId('lab-scroll').evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(400);
  for (const large of [false, true]) {
    if (large) await page.getByTestId('large-type').click();
    for (const width of [360, 412, 480]) {
      await page.setViewportSize({ width, height: 915 });
      for (const density of ['compact', 'comfortable', 'rich']) {
        await page.getByTestId('density-' + density).click(); await page.waitForTimeout(350);
        await page.getByTestId('lab-scroll').evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(100);
        await shot(`lab-${width}-${density}-${large ? 160 : 100}`);
        const plot = await page.getByTestId('lab-timeline-bars-plot').boundingBox();
        const now = await page.getByTestId('lab-timeline-bars').getByText(/^now /).boundingBox();
        assert(plot && now && now.x >= plot.x - 2 && now.x + now.width <= plot.x + plot.width + 2, 'now label stays inside resized plot');
        await page.getByTestId('lab-timeline-bars').evaluate(el => { const scroller = document.querySelector('[data-testid="lab-scroll"]'); if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top; });
        await page.waitForTimeout(150); await shot(`profiler-${width}-${density}-${large ? 160 : 100}`);
        checks.push({ width, density, typePercent: large ? 160 : 100, plotWidth: plot.width });
      }
    }
  }
  await page.getByTestId('large-type').click(); await page.setViewportSize({ width: 412, height: 915 }); await page.getByTestId('density-comfortable').click();
  await page.getByTestId('lab-scroll').evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(300);
  const bounds = await tile().boundingBox(); await touch('touchStart', bounds.x + 3, bounds.y + 8); await page.waitForTimeout(500);
  const wheel = await page.getByTestId('radial-wheel').boundingBox(); assert(wheel && wheel.x >= 0 && wheel.y >= 0 && wheel.x + wheel.width <= 412 && wheel.y + wheel.height <= 915); await shot('wheel-edge'); await touch('touchCancel'); checks.push({ edgeClamp: wheel });
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Settings' }));
  await page.getByRole('radio', { name: 'Left handedness', exact: true }).click();
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Lab' })); await tile().waitFor(); await page.waitForTimeout(400);
  p = await hold(); await shot('wheel-left');
  const pin = await page.getByTestId('radial-pin').boundingBox(); assert(pin && pin.x < p.x); await move(p, -106, 0); await touch('touchEnd'); await page.waitForTimeout(300); assert.match(await tile().innerText(), /Pinned/);
  p = await hold(); await move(p, 0, -106); await shot('wheel-up'); await touch('touchEnd'); await page.getByTestId('tile-detail').waitFor(); await close();
  p = await hold(); await move(p, 0, 106); await shot('wheel-down'); await touch('touchEnd'); await page.waitForTimeout(300); assert.match(await tile().innerText(), /Copied/); checks.push({ leftHanded: true, verticalSelection: true });
  await tile().focus(); await page.keyboard.press('Enter'); await page.getByTestId('tile-detail').waitFor(); await close(); checks.push({ keyboardEnter: true });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(`${base}/lab`); await tile().waitFor();
  await hold(); await shot('wheel-reduced'); await touch('touchCancel');
  await page.getByTestId('lab-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Animate 20', exact: true }).click(); await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('agent-orb').count(), 20);
  const orb = page.getByTestId('agent-orb').first().locator('div').first();
  const a = await orb.evaluate(el => getComputedStyle(el).transform); await page.waitForTimeout(400); const b = await orb.evaluate(el => getComputedStyle(el).transform); assert.equal(a, b); await shot('orbs-reduced'); checks.push({ reducedOrbsStatic: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors: errors.length, out }));
} finally { await browser.close(); }
