// Actual Expo web renderer, synthetic component samples; never phone/live-agent acceptance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const web = resolve('app/dist');
const out = resolve('.moodie-ui-receipts');
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  try {
    const file = resolve(web, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(web + '/') && file !== web) { res.writeHead(403).end(); return; }
    let bytes, type = mime[extname(file)];
    try { bytes = await readFile(file); } catch { bytes = await readFile(resolve(web, 'index.html')); type = 'text/html'; }
    res.writeHead(200, { 'content-type': type ?? 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(500).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
const errors = [], checks = [];
try {
  for (const width of [390, 412]) {
    const context = await browser.newContext({ viewport: { width, height: 915 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug=1`);
    await page.waitForFunction(() => window.__DASH_DEBUG__?.ready);
    await page.evaluate(() => window.__DASH_DEBUG__.scenario('main-bots'));
    // The debug seed selects the label; drive the actual pager before interacting with its pane.
    await page.getByRole('tab').nth(0).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${width}-bots-collapsed.png` });
    await page.getByTestId('tree-row-host:mbp').click();
    await page.getByTestId('bot-face-hermes:clean').first().waitFor();
    await page.screenshot({ path: `${out}/${width}-bots.png` });
    assert.equal(await page.getByTestId('bot-face-hermes:clean').count(), 1);
    await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Lab' }));
    const scroll = page.getByTestId('lab-scroll');
    await scroll.waitFor();
    for (let n = 0; n < 25 && !await page.getByTestId('bot-face-lab').count(); n++) {
      await scroll.evaluate(el => { el.scrollTop += 400; });
      await page.waitForTimeout(120);
    }
    const lab = page.getByTestId('lab-bot-faces');
    await lab.waitFor();
    await lab.evaluate(el => { const sc = document.querySelector('[data-testid="lab-scroll"]'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top; });
    await page.waitForTimeout(250);
    const paths = {};
    for (const state of ['idle', 'thinking', 'working', 'done', 'error']) {
      await page.getByRole('button', { name: `Face state ${state}`, exact: true }).click();
      await page.waitForTimeout(180);
      const faces = lab.locator('[data-testid^="bot-face-hermes:"]');
      assert.equal(await faces.count(), 4);
      assert.equal(await lab.getByTestId('moodie-eye-left').count(), 4);
      paths[state] = await lab.getByTestId('moodie-eye-left').evaluateAll(els => els.map(el => el.getAttribute('d')));
      for (const face of await faces.all()) {
        const box = await face.boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height < 915, 'sample face remains in viewport');
        assert.match(await face.getAttribute('aria-label'), new RegExp(` · ${state} · `));
      }
      await page.screenshot({ path: `${out}/${width}-${state}.png` });
    }
    assert.equal(new Set(paths.idle).size, 4, 'four real resting geometries');
    assert.notDeepEqual(paths.thinking, paths.working);
    assert.notDeepEqual(paths.done, paths.error);
    await page.getByRole('button', { name: 'Face state idle', exact: true }).click();
    assert.deepEqual(await lab.getByTestId('moodie-eye-left').evaluateAll(els => els.map(el => el.getAttribute('d'))), paths.idle);
    const face = lab.getByTestId('bot-face-hermes:clean');
    const before = await face.locator('svg > g').getAttribute('transform');
    await page.waitForTimeout(220);
    assert.equal(await face.locator('svg > g').getAttribute('transform'), before, 'reduced motion stays still');
    await context.close();
    checks.push({ width, states: Object.keys(paths), fourDistinctRestFaces: true, reducedMotionStatic: true });
  }
  const motionContext = await browser.newContext({ viewport: { width: 412, height: 915 }, reducedMotion: 'no-preference' });
  const motionPage = await motionContext.newPage();
  motionPage.on('pageerror', e => errors.push(e.message));
  await motionPage.goto(`http://127.0.0.1:${server.address().port}/?debug=1`);
  await motionPage.waitForFunction(() => window.__DASH_DEBUG__?.ready);
  await motionPage.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Lab' }));
  const motionScroll = motionPage.getByTestId('lab-scroll');
  for (let n = 0; n < 25 && !await motionPage.getByTestId('bot-face-lab').count(); n++) {
    await motionScroll.evaluate(el => { el.scrollTop += 400; });
    await motionPage.waitForTimeout(120);
  }
  await motionPage.getByTestId('lab-bot-faces').evaluate(el => { const sc = document.querySelector('[data-testid="lab-scroll"]'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top; });
  await motionPage.waitForTimeout(250);
  const movingEye = motionPage.getByTestId('bot-face-hermes:clean').locator('svg > g');
  const motionBefore = await movingEye.getAttribute('transform');
  await motionPage.waitForTimeout(400);
  assert.notEqual(await movingEye.getAttribute('transform'), motionBefore, 'bloub gaze moves on the real renderer');
  await motionPage.screenshot({ path: `${out}/412-motion.png` });
  checks.push({ animatedBloubGaze: true });
  await motionContext.close();
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ sourceHead: process.env.D51_SOURCE_SHA, synthetic: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally { await browser.close(); server.close(); }
