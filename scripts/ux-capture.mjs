import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const phase = process.argv[2] ?? 'after';
const out = 'docs/ux/screens-20261020';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:8099?debug=1', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__DASH_DEBUG__?.scenario, null, { timeout: 120000 });
for (const scenario of ['ux-long', 'main-chats']) {
  await page.evaluate(id => window.__DASH_DEBUG__.scenario(id), scenario);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${phase}-${scenario}.png` });
}
await writeFile(`${out}/${phase}-console.json`, JSON.stringify(errors, null, 2));
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
