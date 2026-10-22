#!/usr/bin/env node
// Real Expo web ChatsPane with isolated fixture data. Never connects to a paired host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve('.chat-rows-receipts');
await mkdir(out, { recursive: true });
const port = 8099;
let browser, log = '';
const errors = [], cases = [];
const expo = spawn('bun', ['x', 'expo', 'start', '--web', '--port', String(port)], { cwd: path.resolve('app'), detached: true, env: { ...process.env, CI: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_DEBUG_AUTONAV: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
expo.stdout.on('data', d => log += d);
expo.stderr.on('data', d => log += d);
try {
  let ready = false;
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, 'Disposable Expo web becomes ready');
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 412]) {
    const page = await browser.newPage({ viewport: { width, height: 915 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 120000 });
    await page.evaluate(async () => {
      await window.__DASH_DEBUG__.scenario('main-chats');
      await window.__DASH_DEBUG__.run({ action: 'reset', seed: 'chat-rows' });
    });
    // The debug route resets data, but the native-style pager still needs its measured tab action.
    await page.getByRole('tab').nth(1).click();
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-testid="chat-row-row-rich"]');
      const bounds = row?.getBoundingClientRect();
      return bounds && Math.abs(bounds.left) < 1 && bounds.right <= innerWidth + 1;
    });
    const pane = page.getByTestId('chats-pane');
    await pane.getByText('Pairing now keeps errors visible.', { exact: true }).waitFor();
    for (const text of ['Repair pairing feedback', 'Plan the garden review', 'Inspect the next handoff', 'Check the retry path', 'Folder unknown', 'No summary yet', 'Running tests']) {
      await pane.getByText(text, { exact: true }).waitFor({ state: 'visible' });
    }
    assert.equal(await pane.getByText('Last reply', { exact: true }).count(), 3);
    const bounds = await pane.boundingBox();
    assert(bounds && bounds.height > 300, 'Chats has a bounded list viewport');
    const overflow = await pane.evaluate(el => [...el.querySelectorAll('[data-testid^="chat-row-"]')].map(row => {
      const rect = row.getBoundingClientRect();
      return { id: row.dataset.testid, left: rect.left, right: rect.right, height: rect.height };
    }));
    assert.equal(overflow.length, 4);
    await page.screenshot({ path: path.join(out, `chats-${width}.png`) });
    assert(overflow.every(row => row.left >= -1 && row.right <= width + 1 && row.height >= 68), JSON.stringify({ width, rows: overflow }));
    // Exercise the unchanged row press with this fixture, never a live session.
    await pane.getByTestId('chat-row-row-rich').click();
    await page.waitForFunction(() => window.__DASH_DEBUG__.state().activeId === 'row-rich');
    cases.push({ width, bounds, rows: overflow, pressTarget: 'row-rich', cases: ['rich', 'repo-less', 'no-summary', 'running'] });
    await page.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ status: 'PASS', revision: process.env.DASH_PROOF_REVISION, scope: 'Real Expo web UI + synthetic fixtures; not native phone acceptance', cases, errors }, null, 2));
} catch (error) {
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ status: 'FAIL', error: String(error.stack ?? error), cases, errors }, null, 2));
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-expo.pid, 'SIGTERM'); } catch {}
  await writeFile(path.join(out, 'expo.log'), log);
}
