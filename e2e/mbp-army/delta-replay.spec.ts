import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chatRow, send, type Bridge } from './fixtures';

async function replayRelay(bridge: Bridge, mode: string) {
  const script = join(bridge.dir, 'delta-replay-relay.ts');
  const evidence = join(bridge.dir, 'delta-replays.jsonl');
  await writeFile(script, String.raw`
import { appendFileSync } from 'node:fs';
const [port, mode, evidence] = process.argv.slice(2);
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(req, server) {
    const url = new URL(req.url);
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (server.upgrade(req, { data: { path: url.pathname + url.search, authorization: req.headers.get('authorization'), origin: req.headers.get('origin'), pending: [], upstream: null, first: null } })) return;
      return new Response('Upgrade failed', { status: 400 });
    }
    const forwarded = new Request('http://127.0.0.1:' + port + url.pathname + url.search, req);
    forwarded.headers.set('host', '127.0.0.1:' + port);
    return fetch(forwarded);
  },
  websocket: {
    open(socket) {
      const headers = {};
      if (socket.data.authorization) headers.Authorization = socket.data.authorization;
      if (socket.data.origin) headers.Origin = socket.data.origin;
      const upstream = new WebSocket('ws://127.0.0.1:' + port + socket.data.path, { headers });
      socket.data.upstream = upstream;
      upstream.onopen = () => { for (const raw of socket.data.pending.splice(0)) upstream.send(raw); };
      upstream.onmessage = event => {
        const raw = String(event.data);
        let message;
        try { message = JSON.parse(raw); } catch { socket.send(raw); return; }
        if (message.type === 'delta') {
          if (mode === 'stale-before-fresh' && socket.data.first) socket.send(socket.data.first);
          socket.send(raw);
          if (mode === 'duplicate-in-batch') socket.send(raw);
          appendFileSync(evidence, JSON.stringify({ id: message.id, seq: message.seq, replayed: mode === 'duplicate-in-batch' || Boolean(socket.data.first) }) + '\n');
          socket.data.first ??= raw;
        } else socket.send(raw);
      };
      upstream.onclose = () => socket.close();
      upstream.onerror = () => socket.close(1011, 'Owned relay upstream failed');
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
  const child = spawn(process.env.ARMY_BUN || 'bun', [script, String(bridge.port), mode, evidence], { stdio: ['ignore', 'pipe', 'pipe'] });
  let port = 0;
  let errors = '';
  child.stdout.on('data', data => { const value = Number(String(data).trim()); if (Number.isInteger(value)) port = value; });
  child.stderr.on('data', data => { errors += String(data); });
  try {
    await expect.poll(() => port, { timeout: 15000, message: 'Owned replay relay binds loopback' }).toBeGreaterThan(0);
  } catch (error) { child.kill('SIGKILL'); throw Error(String(error) + '\n' + errors); }
  return {
    bridge: { ...bridge, port }, evidence,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    },
  };
}

for (const mode of ['duplicate-in-batch', 'stale-before-fresh']) {
  test(`stream replay ${mode} preserves the exact agent reply without duplicated text`, async ({ page, bridge }, info) => {
    const relay = await replayRelay(bridge, mode);
    const prompt = `ARMY replay ${mode}`;
    const frames: { endpoint: string; event: string; type?: string }[] = [];
    page.on('websocket', socket => {
      const endpoint = new URL(socket.url()).host;
      frames.push({ endpoint, event: 'open' });
      socket.on('framereceived', frame => {
        let type = 'invalid';
        try { type = JSON.parse(String(frame.payload)).type; } catch { /* Record framing, never credentials. */ }
        frames.push({ endpoint, event: 'received', type });
      });
      socket.on('close', () => frames.push({ endpoint, event: 'closed' }));
    });
    try {
      await openChat(page, bridge);
      await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
      await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${relay.bridge.port}`);
      await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
      await chatRow(page).click();
      await expect(page.getByTestId('chat-window')).toBeVisible();
      await send(page, prompt);
      await expect(page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${prompt}`, { exact: true })).toBeVisible();
      const starts = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.event === 'start' && row.text === prompt);
      expect(starts).toHaveLength(1);
      const replays = (await readFile(relay.evidence, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(replays.some(row => row.replayed)).toBe(true);
      await writeFile(info.outputPath('actual-wire-replays.json'), JSON.stringify(replays, null, 2));
      await page.screenshot({ path: info.outputPath('final.png') });
    } finally {
      await writeFile(info.outputPath('socket-frame-kinds.json'), JSON.stringify(frames, null, 2));
      await relay.stop();
    }
  });
}
