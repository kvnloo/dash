import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const web = resolve(process.env.GENUI_WEB_DIR ?? 'app/dist');
const out = resolve(process.env.GENUI_REPORT_DIR ?? 'docs/genui/screens');
async function fingerprint(dir) {
  const hash = createHash('sha256');
  async function walk(path) {
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, item.name);
      if (item.isDirectory()) await walk(file);
      else hash.update(file.slice(dir.length)).update(await readFile(file));
    }
  }
  await walk(dir);
  return hash.digest('hex');
}
const provenance = { sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'app', 'bridge', 'scripts/genui-qualify.mjs'])).digest('hex'), webSha256: await fingerprint(web) };
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = url.pathname === '/fixture.png' ? resolve('app/assets/icon.png') : resolve(web, '.' + url.pathname);
    if (url.pathname !== '/fixture.png' && !file.startsWith(web + '/') && file !== web) { res.writeHead(403).end(); return; }
    let bytes; let type = mime[extname(file)];
    try { bytes = await readFile(file); } catch { bytes = await readFile(resolve(web, 'index.html')); type = 'text/html'; }
    res.writeHead(200, { 'content-type': type ?? 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const checks = [];
const shot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); checks.push(name); };
const reply = async text => {
  await page.evaluate(text => window.__DASH_DEBUG__.run({ action: 'genuiReply', text }), text);
  await page.waitForTimeout(650);
};
try {
  await page.goto(`http://127.0.0.1:${port}?debug=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready);
  await page.evaluate(() => window.__DASH_DEBUG__.scenario('chat-omp'));
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'setConnection', status: 'offline' }));
  await reply('### A reply becomes a diagram\n```mermaid\nflowchart LR\nAgent[Hermes / omp] -->|reply| UI{Inline UI}\nUI --> Owner[Kevin]\n```');
  await page.getByRole('application', { name: 'Interactive Mermaid diagram' }).waitFor();
  await page.locator('.react-flow__node').filter({ hasText: 'Kevin' }).tap();
  await page.getByRole('status').filter({ hasText: 'Kevin' }).waitFor();
  const before = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('button', { name: /^zoom in$/i }).tap();
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator('.react-flow__viewport').getAttribute('style'), before);
  await shot('01-flowchart');
  await reply('### State transitions\n```mermaid\nstateDiagram-v2\n[*] --> Idle\nIdle --> Working : send\nWorking : The agent is running tools\nWorking --> Done : reply\nDone --> [*]\n```');
  await page.locator('.react-flow__node').filter({ hasText: 'Working' }).tap();
  await page.getByRole('status').filter({ hasText: 'running tools' }).waitFor();
  const canvas = await page.getByRole('application', { name: 'Interactive Mermaid diagram' }).boundingBox();
  for (const node of await page.locator('.react-flow__node').all()) {
    const box = await node.boundingBox();
    assert(box && canvas && box.y >= canvas.y && box.y + box.height <= canvas.y + canvas.height, 'State node clipped after diagram replacement');
  }
  await shot('02-state-diagram');
  await reply('### Inline image\n![Dash icon · local fixture](http://127.0.0.1:' + port + '/fixture.png)');
  const thumb = page.getByRole('button', { name: 'Open image: Dash icon · local fixture', exact: true });
  await thumb.waitFor();
  await page.waitForFunction(() => [...document.images].every(img => img.complete));
  await shot('03-image-thumbnail');
  await thumb.tap();
  await page.getByRole('button', { name: 'Zoom image in', exact: true }).tap();
  await page.getByRole('button', { name: 'Reset image zoom', exact: true }).filter({ hasText: '1.5×' }).waitFor();
  // Actual Chromium touch events drive the custom pinch handler, not just the zoom button.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 350, id: 1 }, { x: 250, y: 350, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 130, y: 350, id: 1 }, { x: 270, y: 350, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 350, id: 1 }, { x: 300, y: 350, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  assert(!((await page.getByRole('button', { name: 'Reset image zoom', exact: true }).textContent()) ?? '').startsWith('1.5×'));
  await shot('04-image-fullscreen-pinch');
  await page.getByRole('button', { name: 'Close image', exact: true }).tap();
  await reply('http://127.0.0.1:' + port + '/fixture.png');
  await page.getByRole('button', { name: 'Open image: Image', exact: true }).waitFor();
  await shot('04b-bare-image-url');
  const genui = { version: 1, components: [{ type: 'card', title: 'Build review', text: 'Generated preview · not an approval', children: [{ type: 'stat', title: 'Checks', value: '12 / 12' }, { type: 'progress', title: 'Ready to review', value: 100 }] }, { type: 'table', title: 'Verification', columns: ['Surface', 'Status'], rows: [['Flowchart', 'Interactive'], ['Image', 'Pinch to zoom']] }, { type: 'choices', id: 'next', title: 'What next?', items: [{ id: 'inspect', label: 'Inspect changes' }, { id: 'revise', label: 'Revise design' }] }] };
  await reply('```genui\n' + JSON.stringify(genui) + '\n```');
  await page.getByText('Build review', { exact: true }).waitFor();
  await page.getByText('Build review', { exact: true }).scrollIntoViewIfNeeded();
  await shot('05a-genui-card');
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).tap();
  await page.getByText('Not sent · agent busy or offline. Try again.', { exact: true }).waitFor();
  await shot('05-genui-card-table-choices');
  await reply('```genui\n' + JSON.stringify({ version: 1, components: [{ type: 'checklist', id: 'review', title: 'Review checklist', items: [{ id: 'pixels', label: 'Inspect pixels', checked: true }, { id: 'tests', label: 'Run tests' }] }, { type: 'timeline', title: 'Build timeline', items: [{ id: 'context', label: 'Context recovered', detail: 'Prior OpenUI and Tern work' }, { id: 'preview', label: 'Preview', detail: 'Ephemeral and sandboxed' }] }] }) + '\n```');
  await page.getByRole('checkbox', { name: 'Inspect pixels', exact: true }).waitFor();
  await shot('06-checklist-timeline');
  await reply('### HTML preview\n```html\n<article style="padding:20px;border:1px solid #d7b986;border-radius:16px"><small>EPHEMERAL / DASH</small><h1>From answer to artifact.</h1><p>Inspect here. Expand into the stage.</p><script>parent.postMessage({type:"evil"},"*"); window.__BAD__=true;</script></article>\n```');
  const frame = page.frameLocator('iframe').first();
  await frame.getByText('From answer to artifact.', { exact: true }).waitFor();
  assert.equal(await page.frames()[1].evaluate(() => window.__BAD__), undefined);
  await shot('07-html-inline');
  await page.getByRole('button', { name: 'Open HTML in stage', exact: true }).tap();
  await page.getByText('HTML preview · unverified', { exact: true }).waitFor();
  await page.frameLocator('iframe').last().getByText('From answer to artifact.', { exact: true }).waitFor();
  await page.waitForTimeout(350);
  await shot('08-html-stage');
  await page.evaluate(() => window.__DASH_DEBUG__.scenario('chat-omp'));
  await reply('```mermaid\nsequenceDiagram\nA->>B: unsupported\n```');
  await page.getByRole('button', { name: 'Copy mermaid code', exact: true }).waitFor();
  assert.equal(await page.getByRole('application', { name: 'Interactive Mermaid diagram' }).count(), 0);
  await shot('09-readable-fallback');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/verification.json`, JSON.stringify({ ...provenance, viewport: { width: 412, height: 915 }, hasTouch: true, checks, pageErrors: errors, class: 'isolated Expo web export, deterministic offline chat fixtures; not a real model or phone' }, null, 2));
  console.log(JSON.stringify({ pass: true, checks, pageErrors: errors, out }));
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png` });
  await writeFile(`${out}/failure.txt`, `${e}\n${await page.locator('body').innerText()}`);
  throw e;
} finally { await browser.close(); server.close(); }
