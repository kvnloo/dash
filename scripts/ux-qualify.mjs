import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
async function fingerprint() {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat();
  }
  const hash = createHash('sha256');
  for (const file of [...await walk('app/src'), 'app/package.json', 'app/bun.lock', 'app/metro.config.js'].sort()) hash.update(file).update(await readFile(file));
  return hash.digest('hex');
}
const sourceHash = await fingerprint();
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
import assert from 'node:assert/strict';
const out = 'docs/ux/screens-20261020';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto('http://localhost:8099?debug=1', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__DASH_DEBUG__?.scenario);
await page.evaluate(() => window.__DASH_DEBUG__.scenario('ux-long'));
await page.waitForTimeout(1600);
const rail = page.getByLabel('Prompt navigator', { exact: true });
await rail.waitFor();
const box = await rail.boundingBox();
assert(box && box.width >= 44);
const latest = page.getByRole('button', { name: 'Latest reply', exact: true });
const latestBox = await latest.boundingBox();
assert(latestBox.height >= 44);
// Actual rendered headings, code token spans, collapsed activity and copy.
assert(await page.getByText('Keep the reader in control', { exact: true }).count() > 0);
await page.getByRole('button', { name: 'Copy typescript code', exact: true }).last().click();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'const following = distanceFromBottom <= 48;\nfunction onOutput() {\n  if (following) scrollToEnd();\n}');
const activity = page.getByRole('button', { name: 'Activity · 1 update', exact: true }).last();
assert.equal(await activity.getAttribute('aria-expanded'), 'false');
await activity.click();
assert.equal(await activity.getAttribute('aria-expanded'), 'true');
await activity.click();
// Scrub to prompt 7 and keep the finger down to capture the floating preview.
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.27);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.29, { steps: 4 });
await page.waitForTimeout(900);
await page.getByText('Prompt 7 of 24', { exact: true }).waitFor();
await page.screenshot({ path: `${out}/after-scrub-preview.png` });
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8, { steps: 24 });
await page.getByText('Prompt 20 of 24', { exact: true }).waitFor();
await page.mouse.up();
// Explicit reasoning is hidden until the owner opens it.
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.48);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.49, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(700);
assert.equal(await page.getByText('Copied', { exact: true }).count(), 0, 'Copy state leaked through a recycled row');
const thinking = page.getByRole('button', { name: 'Thinking', exact: true });
assert.equal(await thinking.getAttribute('aria-expanded'), 'false');
await thinking.click();
await page.getByText('Check the measured row offset before jumping.', { exact: true }).waitFor();
await page.screenshot({ path: `${out}/after-thinking-expanded.png` });
await thinking.click();
// Find FlashList's vertical scroll container, not a horizontal code block.
const position = () => page.evaluate(() => {
  const node = [...document.querySelectorAll('div')].find(e => e.scrollHeight > e.clientHeight + 200 && e.clientHeight > 200 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY));
  if (!node) throw new Error('No transcript scroller');
  return { top: node.scrollTop, gap: node.scrollHeight - node.clientHeight - node.scrollTop };
});
const reading = await position();
assert(reading.gap > 500);
await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'uxOutput', text: '\n\nLive addition.\n'.repeat(15) }));
await page.waitForTimeout(1000);
assert(Math.abs((await position()).top - reading.top) < 4, 'Output moved the reader away from the old prompt');
await page.getByRole('button', { name: 'Latest live reply', exact: true }).click();
await page.waitForTimeout(800);
assert((await position()).gap < 50, 'Latest did not return to bottom');
await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'uxOutput', text: '\nFollowing output.\n'.repeat(12) }));
await page.waitForTimeout(1000);
assert((await position()).gap < 50, 'Streaming did not follow');
// Wheel up must detach on web as well as native drag.
await page.mouse.move(150, 450);
await page.mouse.wheel(0, -550);
await page.waitForTimeout(700);
const wheelReading = await position();
assert(wheelReading.gap > 100);
await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'uxOutput', text: '\nDo not move the reader.\n'.repeat(12) }));
await page.waitForTimeout(900);
assert(Math.abs((await position()).top - wheelReading.top) < 4);
await page.screenshot({ path: `${out}/after-reading-during-stream.png` });
await page.getByRole('button', { name: 'Latest live reply', exact: true }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/after-latest-live.png` });
for (const width of [390, 412, 640]) {
  await page.setViewportSize({ width, height: 915 });
  await page.evaluate(() => window.__DASH_DEBUG__.scenario('ux-long'));
  await page.waitForTimeout(1000);
  assert(await rail.isVisible());
  assert(await page.getByRole('textbox', { name: 'Message', exact: true }).isVisible());
  await page.screenshot({ path: `${out}/after-chat-${width}.png` });
}
assert.deepEqual(errors, []);
assert.equal(await fingerprint(), sourceHash, 'Source changed during qualification');
await writeFile(`${out}/qualification.json`, JSON.stringify({ sourceHead, sourceHash, viewport: '412x915', assertions: ['Markdown rendered', 'code copy matches', 'activity collapsed and expandable', '44px rail and latest hits', 'scrub to prompt 7 with preview', 'stream preserves reading position', 'latest resumes follow', 'stream follows bottom', 'wheel detaches follow', '390/412/640 layout'], errors }, null, 2));
await browser.close();
console.log('UX qualification PASS');
