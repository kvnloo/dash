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
const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/army-held') return Response.json({ held: held.length, delivered });
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
    return fetch(forwarded);
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
        const starts = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.event === 'start' && row.text === prompt);
        expect(starts).toHaveLength(1);
        if (mode === 'delayed') {
          const caughtUp = `ARMY_STREAM_BEGIN ARMY_REPLY: ${prompt} [native caught up]`;
          // Advance the actual native source after it lagged the completed ACP turn.
          const writer = spawn(process.env.ARMY_BUN || 'bun', ['-e', `
            const { Database } = require('bun:sqlite');
            const [path, prompt, answer] = process.argv.slice(1);
            const db = new Database(path), at = Date.now() / 1000;
            const add = db.query('INSERT INTO messages (session_id,role,content,timestamp,active) VALUES (?,?,?,?,1)');
            db.transaction(() => {
              add.run('army-long-hermes','user',prompt,at);
              add.run('army-long-hermes','assistant',answer,at + 0.001);
              db.query('UPDATE sessions SET message_count=6,last_activity_at=? WHERE id=?').run(at + 0.001,'army-long-hermes');
            })();
            db.close();
          `, join(bridge.dir, '.hermes', 'state.db'), prompt, caughtUp], { stdio: 'ignore' });
          const [code] = await once(writer, 'exit');
          expect(code).toBe(0);
          await expect(page.getByText(caughtUp, { exact: true })).toBeVisible({ timeout: 15000 });
          await expect(answer).toHaveCount(0);
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
