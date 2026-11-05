#!/usr/bin/env node
// Expo web render of the production reducer path (applyTurnEvent) fed a REPRESENTATIVE REDACTED FIXTURE.
// Not live-agent data and not Android acceptance: browser DPR does not emulate Android fontScale.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve(process.env.DASH_PROOF_DIR ?? '.chat-density-receipts');
await mkdir(out, { recursive: true });
const port = Number(process.env.DASH_PROOF_PORT ?? 8199);
const checks = [];
const errors = [];
const check = (name, ok, evidence) => { checks.push({ name, ok: Boolean(ok), evidence }); if (!ok) console.log(`FAIL ${name} ${JSON.stringify(evidence)}`); };

const repo = '/repo/dash';
const longPath = `${repo}/app/src/lib/parsers/very/deeply/nested/module/unterminated-string-parser.ts`;
const longPath2 = longPath.replace('unterminated', 'escape');
const failLog = Array.from({ length: 300 }, (_, i) => `  ✓ parser case ${i} [0.1ms]`).join('\n')
  + '\n(fail) parser rejects unterminated string [2.1ms]\nerror: expected 1 got 0 · Authorization: Bearer sk-fixtureSECRET0123456789\nRan 301 tests across 1 file. [88ms]';
const summaries = { earlier: 'Read the parser and its tests before changing escapes', latest: 'Rerunning the failing parser test after fixing escape handling' };
const reasoning = Array.from({ length: 40 }, (_, i) => `raw reasoning line ${i + 1}: weigh escape handling against the unterminated-string branch`).join('\n') + '\n';

const expo = spawn('bun', ['x', 'expo', 'start', '--web', '--port', String(port)], { cwd: path.resolve('app'), detached: true, env: { ...process.env, CI: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_DEBUG_AUTONAV: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; expo.stdout.on('data', d => log += d); expo.stderr.on('data', d => log += d);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${port}`)).ok; } catch {} if (!ready) await new Promise(r => setTimeout(r, 1000)); }
  if (!ready) throw new Error('Metro not ready');
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 412]) {
    const context = await browser.newContext({ viewport: { width, height: 915 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${width}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 240000 });
    await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 180000 });
    let seq = 0;
    const run = cmd => page.evaluate(c => window.__DASH_DEBUG__.run(c), cmd);
    const part = p => run({ action: 'replyFixture', part: p, seq: ++seq });
    const summary = (blockId, kind, text) => run({ action: 'thinkingSummary', summary: { blockId, kind, text, model: 'fixture', durationMs: 6000 } });
    await run({ action: 'replyFixture', reset: true, seq: ++seq });
    await page.waitForTimeout(400);
    await summary('s-earlier', 'final', summaries.earlier);
    await part({ kind: 'reasoning', text: reasoning });
    for (const [id, p, offset, limit] of [['read-1', longPath, 1, 40], ['read-2', longPath2, 80, 20]]) {
      await part({ kind: 'tool_start', callId: id, name: 'read_file', summary: p, args: JSON.stringify({ path: p, offset, limit }) });
      await part({ kind: 'tool_output', callId: id, text: 'export function parse(input: string) {\n  return tokens(input);\n}\n', truncated: false });
      await part({ kind: 'tool_finish', callId: id, status: 'ok', durationMs: 120 });
    }
    await part({ kind: 'tool_start', callId: 'term-fail', name: 'terminal', summary: 'bun test app/src/lib/parsers/parser.test.ts', args: JSON.stringify({ command: 'bun test app/src/lib/parsers/parser.test.ts', workdir: repo }) });
    await part({ kind: 'tool_output', callId: 'term-fail', text: JSON.stringify({ output: failLog.slice(-6000), exit_code: 1 }), truncated: true });
    await part({ kind: 'tool_finish', callId: 'term-fail', status: 'error', durationMs: 2400 });
    await part({ kind: 'tool_start', callId: 'acp-term', name: 'terminal', summary: 'terminal', args: '$ bun test parser.test.ts' });
    await part({ kind: 'tool_output', callId: 'acp-term', text: 'terminal result\n- **output:** 1 fail\n- **exit_code:** 1', truncated: false });
    await part({ kind: 'tool_finish', callId: 'acp-term', status: 'error', durationMs: 1800 });
    await part({ kind: 'tool_start', callId: 'term-retry', name: 'terminal', summary: 'bun test --rerun-each 3 app/src/lib/parsers/parser.test.ts', args: JSON.stringify({ command: 'bun test --rerun-each 3 app/src/lib/parsers/parser.test.ts', workdir: repo }) });
    await part({ kind: 'tool_output', callId: 'term-retry', text: 'Running parser.test.ts (attempt 2 of 3)\n', truncated: false });
    await summary('s-latest', 'live', summaries.latest);
    await run({ action: 'replyFixture', text: 'Found the escape bug; the retry is running.', seq: ++seq });
    await page.waitForTimeout(600);

    // Painted = some leaf holding the text is unclamped, inside every clipping ancestor and the viewport, and wins a hit test.
    const probe = needle => page.evaluate(n => {
      const leaves = [...document.querySelectorAll('body *')].filter(el => el.textContent?.includes(n) && ![...el.children].some(c => c.textContent?.includes(n)));
      const shown = leaves.filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0'; });
      const measure = el => {
        el.scrollIntoView({ block: el.getBoundingClientRect().height > innerHeight / 2 ? 'start' : 'center' });
        const r = el.getBoundingClientRect();
        let v = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) };
        let clipHeight = Infinity;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const s = getComputedStyle(a); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
          const c = a.getBoundingClientRect(); clipHeight = Math.min(clipHeight, c.height);
          v = { left: Math.max(v.left, c.left), top: Math.max(v.top, c.top), right: Math.min(v.right, c.right), bottom: Math.min(v.bottom, c.bottom) };
        }
        const visibleHeight = Math.max(0, v.bottom - v.top), visibleWidth = Math.max(0, v.right - v.left);
        const hit = visibleHeight > 0 && document.elementFromPoint(v.left + Math.min(visibleWidth / 2, 40), v.top + Math.min(visibleHeight / 2, 8));
        const scrollsInside = r.height > clipHeight;
        return { text: el.textContent.slice(0, 160), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          inViewport: scrollsInside ? visibleHeight >= 32 : Math.abs(visibleHeight - r.height) <= 1 && Math.abs(visibleWidth - r.width) <= 1,
          unclipped: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1, hit: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
      };
      const results = shown.map(measure);
      const best = results.find(x => x.inViewport && x.unclipped && x.hit) ?? results[0];
      return best ? { painted: shown.length, ...best } : { painted: 0 };
    }, needle);
    const readable = async (name, needle) => { const p = await probe(needle); check(`${width} ${name}`, p.painted >= 1 && p.inViewport && p.unclipped && p.hit, { needle, ...p }); return p; };
    const tryClick = async (name, locator) => { try { await locator.click({ timeout: 3000 }); return true; } catch (e) { check(`${width} ${name}`, false, { error: String(e).slice(0, 200) }); return false; } };
    const setMode = async mode => {
      await page.getByRole('button', { name: 'Chat options', exact: true }).click();
      await page.getByRole('button', { name: `Details ${mode}`, exact: true }).click();
      await page.getByRole('button', { name: 'Chat options', exact: true }).click();
      await page.waitForTimeout(400);
    };
    await setMode('Compact');
    const body = () => page.evaluate(() => document.body.innerText);
    await readable('Compact read path 1', 'unterminated-string-parser.ts:1–40');
    await readable('Compact read path 2', 'escape-string-parser.ts:80–99');
    await readable('Compact failed command', 'terminal · bun test app/src/lib/parsers/parser.test.ts');
    await readable('Compact failure meaning', 'failed · exit 1 · parser rejects unterminated string');
    await readable('Compact running retry', 'terminal · bun test --rerun-each 3');
    await readable('Compact running state', 'running · Running parser.test.ts (attempt 2 of 3)');
    await readable('Compact ACP command identity', 'terminal · bun test parser.test.ts');
    check(`${width} no terminal · terminal`, !(await body()).includes('terminal · terminal'), {});
    check(`${width} secret redacted`, !(await body()).includes('fixtureSECRET0123456789'), {});
    const latest = await readable('Compact latest summary', summaries.latest);
    check(`${width} latest summary painted once`, latest.painted === 1, latest);
    check(`${width} earlier summary not repeated`, (await probe(summaries.earlier)).painted === 0, {});
    check(`${width} raw reasoning hidden until asked`, (await probe('raw reasoning line 20:')).painted === 0, {});
    const load = await readable('Compact incomplete output label', 'Output preview is incomplete');
    const loadBox = await page.getByRole('button', { name: /^Load retained output for terminal · bun test app/ }).boundingBox({ timeout: 3000 }).catch(() => null);
    check(`${width} load button touch target >= 44`, loadBox && loadBox.height >= 44, { loadBox, load });
    await probe(summaries.latest);
    await page.screenshot({ path: path.join(out, `${width}-compact.png`) });
    const reasoningButton = page.getByRole('button', { name: 'Reasoning', exact: true });
    check(`${width} reasoning toggle exists`, await reasoningButton.count() === 1, {});
    if (await reasoningButton.count()) { await reasoningButton.click(); await page.waitForTimeout(300); await readable('Compact reasoning on demand', 'raw reasoning line 1:'); await page.screenshot({ path: path.join(out, `${width}-compact-reasoning.png`) }); await reasoningButton.click(); }
    await setMode('Full');
    const rows = await page.locator('[data-testid*=":call:"]').count();
    check(`${width} Full exposes each call`, rows === 5, { rows });
    check(`${width} Full has no generic group`, (await probe('earlier call')).painted === 0 && (await probe('×2')).painted === 0, {});
    await readable('Full raw reasoning', 'raw reasoning line 1:');
    await page.screenshot({ path: path.join(out, `${width}-full.png`) });
    await tryClick('load retained output', page.getByRole('button', { name: /^Load retained output for terminal · bun test app/ }));
    await part({ kind: 'tool_detail', callId: 'term-fail', args: JSON.stringify({ command: 'bun test app/src/lib/parsers/parser.test.ts', workdir: repo }), text: JSON.stringify({ output: failLog.replace(/sk-\w+/, '[REDACTED]'), exit_code: 1 }), truncated: false });
    await page.waitForTimeout(400);
    check(`${width} retained output fetched clears incomplete label`, (await probe('Output preview is incomplete')).painted === 0, {});
    await tryClick('expand failed call', page.locator('[data-testid$=":call:term-fail"]'));
    await page.waitForTimeout(300);
    await tryClick('open output inspector', page.locator('[data-testid$=":output:term-fail"]'));
    await page.waitForTimeout(400);
    await readable('Inspector shows retained output', 'parser case 0 ');
    await page.screenshot({ path: path.join(out, `${width}-inspector.png`) });
    await context.close();
  }
  if (errors.length) check('no page errors', false, errors);
} catch (error) {
  check('script completed', false, { error: String(error?.stack ?? error), log: log.slice(-2000) });
} finally {
  await browser?.close();
  try { process.kill(-expo.pid, 'SIGTERM'); } catch {}
}
const failed = checks.filter(c => !c.ok);
await writeFile(path.join(out, 'receipt.json'), JSON.stringify({ fixture: 'representative redacted event fixture, not live data', surface: 'Expo web, Chromium', checks, failed: failed.length }, null, 2));
console.log(JSON.stringify({ checks: checks.length, failed: failed.length, out }));
process.exit(failed.length ? 1 : 0);
