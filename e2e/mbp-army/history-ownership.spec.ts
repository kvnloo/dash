import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, createBridge, pair, send, LONG_HERMES_TITLE, type Bridge } from './fixtures';

// Hold actual authenticated history bytes, never seed the application or replace a route.
async function historyRelay(bridge: Bridge) {
  const script = join(bridge.dir, 'history-relay.ts');
  await writeFile(script, String.raw`
const [port] = process.argv.slice(2);
let held = []; let holding = true; let delivered = 0;
let freezeNative = false; let nativeHeld = 0; const nativeWaiters = [];
let holdOlder = false; let olderDelivered = 0; const olderWaiters = []; const olderSnapshots = [];
const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/army-held') return Response.json({ held: held.length, delivered, nativeHeld, olderHeld: olderWaiters.length, olderDelivered, olderSnapshots });
    if (url.pathname === '/army-freeze-native' && req.method === 'POST') {
      freezeNative = true; return Response.json({ frozen: true });
    }
    if (url.pathname === '/army-release-native' && req.method === 'POST') {
      freezeNative = false;
      for (const release of nativeWaiters.splice(0)) release();
      return Response.json({ released: true });
    }
    if (url.pathname === '/army-freeze-older' && req.method === 'POST') {
      holdOlder = true; return Response.json({ frozen: true });
    }
    if (url.pathname === '/army-release-one-older' && req.method === 'POST') {
      const release = olderWaiters.shift();
      if (!release) return new Response('No held older page', { status: 409 });
      olderDelivered++; release();
      return Response.json({ olderDelivered });
    }
    if (url.pathname === '/army-release' && req.method === 'POST') {
      holding = false;
      for (const item of held.splice(0)) {
        const message = JSON.parse(item.raw);
        if (url.searchParams.has('unknown')) message.requestId = 'unknown-history-owner';
        item.socket.send(url.searchParams.has('unknown') ? JSON.stringify(message) : item.raw);
        delivered++;
      }
      return Response.json({ delivered });
    }
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (server.upgrade(req, { data: { path: url.pathname + url.search, authorization: req.headers.get('authorization'), origin: req.headers.get('origin'), pending: [], upstream: null } })) return;
      return new Response('Upgrade failed', { status: 400 });
    }
    const forwarded = new Request('http://127.0.0.1:' + port + url.pathname + url.search, req);
    forwarded.headers.set('host', '127.0.0.1:' + port);
    return fetch(forwarded).then(async response => {
      if (holdOlder && req.method === 'GET' && url.pathname === '/chats/history' && url.searchParams.has('before')) {
        const body = await response.arrayBuffer();
        const page = JSON.parse(new TextDecoder().decode(body));
        const ordinal = olderSnapshots.push({ before: url.searchParams.get('before'), prompts: page.messages.filter(row => row.role === 'user').map(row => row.text) });
        const headers = new Headers(response.headers);
        headers.set('x-army-older-page', String(ordinal));
        headers.set('access-control-expose-headers', 'ETag, X-Army-Older-Page');
        headers.set('cache-control', 'no-store');
        await new Promise(resolve => olderWaiters.push(resolve));
        return new Response(body, { status: response.status, headers });
      }
      if (freezeNative && (url.pathname === '/hermes/activity' || url.pathname === '/chats/history')) {
        nativeHeld++;
        await new Promise(resolve => nativeWaiters.push(resolve));
      }
      return response;
    });
  }, websocket: {
    open(socket) {
      const headers = {};
      if (socket.data.authorization) headers.Authorization = socket.data.authorization;
      if (socket.data.origin) headers.Origin = socket.data.origin;
      const upstream = new WebSocket('ws://127.0.0.1:' + port + socket.data.path, { headers });
      socket.data.upstream = upstream;
      upstream.onopen = () => { for (const raw of socket.data.pending.splice(0)) upstream.send(raw); };
      upstream.onmessage = event => {
        const raw = String(event.data); let message;
        try { message = JSON.parse(raw); } catch { socket.send(raw); return; }
        if (holding && message.type === 'history' && message.sessionId === 'army-long-hermes') held.push({ socket, raw });
        else socket.send(raw);
      };
      upstream.onclose = () => socket.close();
      upstream.onerror = () => socket.close(1011, 'Owned history upstream failed');
    },
    message(socket, raw) {
      if (socket.data.upstream?.readyState === WebSocket.OPEN) socket.data.upstream.send(raw);
      else socket.data.pending.push(raw);
    },
    close(socket) { socket.data.upstream?.close(); },
  },
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
console.log(String(server.port));
`);
  const child = spawn(process.env.ARMY_BUN || 'bun', [script, String(bridge.port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let port = 0; let errors = '';
  child.stdout.on('data', data => { const value = Number(String(data).trim()); if (Number.isInteger(value)) port = value; });
  child.stderr.on('data', data => { errors += String(data); });
  try { await expect.poll(() => port, { timeout: 15000, message: 'Owned history relay binds loopback' }).toBeGreaterThan(0); }
  catch (error) { child.kill('SIGKILL'); throw Error(String(error) + '\n' + errors); }
  return { port, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  } };
}

for (const mode of ['delayed', 'unknown', 'unchanged']) {
  test(`history ownership ${mode} newest response preserves its transcript owner`, async ({ page }, info) => {
    const bridge = await createBridge(true, { env: { ARMY_LONG_HERMES: '2' } });
    const relay = await historyRelay(bridge);
    const control = `http://127.0.0.1:${relay.port}`;
    await fetch(control + '/army-freeze-native', { method: 'POST' });
    const received: { requestId?: string; count: number }[] = [];
    let completed = 0;
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'done') completed++;
        if (message.type === 'history' && message.sessionId === 'army-long-hermes') received.push({ requestId: message.requestId, count: message.messages.length });
      } catch { /* No credential capture. */ }
    }));
    try {
      await pair(page, bridge);
      await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${relay.port}`);
      await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
      const row = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) });
      await expect(row).toHaveCount(1); await row.click();
      await expect(page.getByTestId('chat-window')).toBeVisible();
      await expect.poll(async () => (await (await fetch(control + '/army-held')).json()).held).toBeGreaterThan(0);
      const release = async () => {
        const before = received.length;
        const result = await (await fetch(control + '/army-release' + (mode === 'unknown' ? '?unknown=1' : ''), { method: 'POST' })).json();
        expect(result.delivered).toBeGreaterThan(0);
        await expect.poll(() => received.length).toBeGreaterThan(before);
        expect(received.at(-1)?.count).toBeGreaterThan(0);
      };
      if (mode === 'unchanged') {
        await release();
        await expect(page.getByText(/^ARMY hermes answer 002 /)).toBeVisible();
      } else {
        const prompt = `ARMY history ownership ${mode}`;
        await send(page, prompt);
        await expect.poll(() => completed).toBeGreaterThan(0);
        const latest = page.getByRole('button', { name: 'Latest reply', exact: true });
        if (await latest.isVisible()) await latest.click();
        const answer = page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${prompt}`, { exact: true });
        await expect(answer).toBeVisible();
        const promptMarkers = page.getByRole('slider', { name: 'Prompt navigator', exact: true }).getByTestId('rail-tick');
        await expect(promptMarkers).toHaveCount(1);
        await release();
        // A fresh browser frame after receipt ensures React has painted the history handler.
        await page.evaluate(() => {
          const { promise, resolve } = Promise.withResolvers<void>();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          return promise;
        });
        if (await latest.isVisible()) await latest.click();
        await expect(answer).toBeVisible();
        await expect(page.getByText(prompt, { exact: true })).toBeVisible();
        // Frozen HTTP history cannot mask a wrongly accepted WebSocket window.
        await expect(promptMarkers).toHaveCount(1);
        const starts = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.event === 'start' && row.text === prompt);
        expect(starts).toHaveLength(1);
        if (mode === 'delayed') {
          const caughtUp = `ARMY_STREAM_BEGIN ARMY_REPLY: ${prompt}`;
          const laterNative = 'ARMY next native activity after phone catch-up';
          const writeNative = async (stage: 'user' | 'assistant') => {
            const writer = spawn(process.env.ARMY_BUN || 'bun', ['-e', `
              const { Database } = require('bun:sqlite');
              const [path, prompt, answer, stage] = process.argv.slice(1);
              const db = new Database(path), at = Date.now() / 1000;
              db.query('INSERT INTO messages (session_id,role,content,timestamp,active) VALUES (?,?,?,?,1)')
                .run('army-long-hermes',stage,stage === 'user' ? prompt : answer,at);
              if (stage === 'assistant') db.query('INSERT INTO messages (session_id,role,content,timestamp,active) VALUES (?,?,?,?,1)')
                .run('army-long-hermes','assistant','ARMY next native activity after phone catch-up',at + 0.001);
              db.query('UPDATE sessions SET message_count=?,last_activity_at=? WHERE id=?')
                .run(stage === 'user' ? 5 : 7,at + 0.001,'army-long-hermes');
              db.close();
            `, join(bridge.dir, '.hermes', 'state.db'), prompt, caughtUp, stage], { stdio: 'ignore' });
            const [code] = await once(writer, 'exit');
            expect(code).toBe(0);
          };
          const partial = page.waitForResponse(async response => {
            if (new URL(response.url()).pathname !== '/hermes/activity' || response.status() !== 200) return false;
            const rows = await response.json();
            return Array.isArray(rows) && rows.some(row => row.role === 'user' && row.text === prompt)
              && !rows.some(row => row.role === 'assistant' && row.text === caughtUp);
          });
          await writeNative('user');
          await fetch(control + '/army-release-native', { method: 'POST' });
          await partial;
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          await expect(answer).toBeVisible();
          await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
          await writeNative('assistant');
          await expect(page.getByText(laterNative, { exact: true })).toBeVisible({ timeout: 15000 });
          await expect(answer).toHaveCount(1);
          await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
        }
      }
      await writeFile(info.outputPath('history-wire-ownership.json'), JSON.stringify({ mode, received, relay: await (await fetch(control + '/army-held')).json() }, null, 2));
      await page.screenshot({ path: info.outputPath('final.png') });
    } finally {
      await relay.stop(); await bridge.dispose();
    }
  });
}

test('cached inactive Hermes chat hydrates before requesting its fresh owned newest window', async ({ page }, info) => {
  const bridge = await createBridge(true, { env: { ARMY_LONG_HERMES: '2' } });
  const relay = await historyRelay(bridge);
  const control = `http://127.0.0.1:${relay.port}`;
  const freshAnswer = 'ARMY native answer 003 after cold reload';
  let freshFrame = false;
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try {
      const message = JSON.parse(String(frame.payload));
      if (message.type === 'history' && message.sessionId === 'army-long-hermes'
        && message.messages.some((row: { text?: string }) => row.text === freshAnswer)) freshFrame = true;
    } catch { /* No credential capture. */ }
  }));
  try {
    await fetch(control + '/army-release', { method: 'POST' });
    await pair(page, bridge);
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${relay.port}`);
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    const row = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page.getByText(/^ARMY hermes answer 002 /)).toBeVisible();
    await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
    const rowId = await row.getAttribute('data-testid');
    if (!rowId) throw Error('Cached chat must retain a rendered row identity');
    await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click();
    await send(page, 'ARMY leave native chat inactive before reload');
    await expect(page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: ARMY leave native chat inactive before reload', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) =>
      key.startsWith('dash.cache.files.v2/') && value.includes('ARMY hermes answer 002')))).toBe(true);
    await fetch(control + '/army-freeze-native', { method: 'POST' });
    const writer = spawn(process.env.ARMY_BUN || 'bun', ['-e', `
      const { Database } = require('bun:sqlite');
      const [path, answer] = process.argv.slice(1);
      const db = new Database(path), at = Date.now() / 1000;
      const add = db.query('INSERT INTO messages (session_id,role,content,timestamp,active) VALUES (?,?,?,?,1)');
      db.transaction(() => {
        add.run('army-long-hermes','user','ARMY native prompt 003',at);
        add.run('army-long-hermes','assistant',answer,at + 0.001);
        db.query('UPDATE sessions SET message_count=6,last_activity_at=? WHERE id=?').run(at + 0.001,'army-long-hermes');
      })();
      db.close();
    `, join(bridge.dir, '.hermes', 'state.db'), freshAnswer], { stdio: 'ignore' });
    const [code] = await once(writer, 'exit');
    expect(code).toBe(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab').nth(1).click();
    await expect(page.getByTestId(rowId)).toBeVisible();
    await page.getByTestId(rowId).click();
    await expect.poll(() => freshFrame).toBe(true);
    const latest = page.getByRole('button', { name: 'Latest reply', exact: true });
    if (await latest.isVisible()) await latest.click();
    await expect(page.getByTestId('transcript-viewport').getByText(freshAnswer, { exact: true })).toBeVisible();
    await expect.poll(async () => (await (await fetch(control + '/army-held')).json()).nativeHeld).toBeGreaterThan(0);
    await writeFile(info.outputPath('cached-history-ordering.json'), JSON.stringify({ freshFrame, rowId, relay: await (await fetch(control + '/army-held')).json() }, null, 2));
    await page.screenshot({ path: info.outputPath('final.png') });
  } finally { await relay.stop(); await bridge.dispose(); }
});

test('reopening native chat rejects its closed visit older page and displays the current source prompts', async ({ page }, info) => {
  const bridge = await createBridge(true, { env: { ARMY_LONG_HERMES: '30' } });
  const relay = await historyRelay(bridge);
  const control = `http://127.0.0.1:${relay.port}`;
  const refreshedPrompt = 'ARMY refreshed Hermes prompt 001';
  try {
    await fetch(control + '/army-release', { method: 'POST' });
    await fetch(control + '/army-freeze-older', { method: 'POST' });
    await pair(page, bridge);
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${relay.port}`);
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    const row = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page.getByText(/^ARMY hermes answer 030 /)).toBeVisible();
    const rail = page.getByRole('slider', { name: 'Prompt navigator', exact: true });
    const ticks = rail.getByTestId('rail-tick');
    await expect.poll(async () => (await (await fetch(control + '/army-held')).json()).olderHeld).toBe(1);
    await expect(ticks).toHaveCount(25);

    // Change the real isolated native row after its first HTTP page was produced.
    // Timestamp and id stay fixed, so reopening legitimately uses the same keyset cursor.
    const writer = spawn(process.env.ARMY_BUN || 'bun', ['-e', `
      const { Database } = require('bun:sqlite');
      const [path, text] = process.argv.slice(1);
      const db = new Database(path);
      const changed = db.query('UPDATE messages SET content=? WHERE session_id=? AND role=? AND content=?')
        .run(text,'army-long-hermes','user','ARMY hermes prompt 001').changes;
      db.close();
      process.exit(changed === 1 ? 0 : 1);
    `, join(bridge.dir, '.hermes', 'state.db'), refreshedPrompt], { stdio: 'ignore' });
    const [code] = await once(writer, 'exit');
    expect(code).toBe(0);
    await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
    await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click();
    await send(page, 'ARMY leave held older history visit');
    await expect(page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: ARMY leave held older history visit', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await row.click();
    await expect(page.getByText(/^ARMY hermes answer 030 /)).toBeVisible();
    await expect.poll(async () => (await (await fetch(control + '/army-held')).json()).olderHeld).toBe(2);
    const snapshot = await (await fetch(control + '/army-held')).json();
    expect(snapshot.olderSnapshots[0].before).toBe(snapshot.olderSnapshots[1].before);
    expect(snapshot.olderSnapshots[0].prompts).toContain('ARMY hermes prompt 001');
    expect(snapshot.olderSnapshots[1].prompts).toContain(refreshedPrompt);

    const oldResponse = page.waitForResponse(async response => await response.headerValue('x-army-older-page') === '1');
    expect((await fetch(control + '/army-release-one-older', { method: 'POST' })).status).toBe(200);
    const releasedOld = await oldResponse;
    expect(releasedOld.status()).toBe(200);
    await releasedOld.finished();
    const releasedPage = await releasedOld.json();
    expect(releasedPage.messages.filter((row: { role: string }) => row.role === 'user').map((row: { text: string }) => row.text)).toContain('ARMY hermes prompt 001');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(ticks).toHaveCount(25);
    expect((await fetch(control + '/army-release-one-older', { method: 'POST' })).status).toBe(200);
    await expect(ticks).toHaveCount(30);
    const box = await rail.boundingBox();
    if (!box) throw Error('Current source prompt rail has no rendered bounds');
    await page.mouse.click(box.x + box.width / 2, box.y + 1);
    await expect(page.getByLabel('Turn preview', { exact: true })).toContainText(refreshedPrompt);
    await page.getByRole('button', { name: 'Jump', exact: true }).click();
    await page.getByRole('button', { name: 'Close turn preview', exact: true }).click();
    await expect(page.getByTestId('transcript-viewport').getByText(refreshedPrompt, { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('final.png') });
    await writeFile(info.outputPath('history-visit-source.json'), JSON.stringify(snapshot, null, 2));
  } finally { await relay.stop(); await bridge.dispose(); }
});
