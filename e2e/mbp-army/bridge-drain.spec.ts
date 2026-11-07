import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, send } from './fixtures';

const RESTART_MESSAGE = 'This computer is restarting for an update; try again in a minute.';

test('bridge drain preserves the running reply, refuses new chat and voice, and exits cleanly', async ({ page, bridge }) => {
  await openChat(page, bridge);
  const origin = `http://127.0.0.1:${bridge.port}`;
  const token = (await readFile(join(bridge.dir, '.dash/token'), 'utf8')).trim();
  const headers = { Authorization: `Bearer ${token}` };
  const before = await fetch(`${origin}/health`);
  expect(before.status).toBe(401);
  const unauthorizedDrain = await fetch(`${origin}/drain`, { method: 'POST' });
  expect(unauthorizedDrain.status).toBe(401);
  const healthy = await fetch(`${origin}/health`, { headers });
  expect(healthy.status).toBe(200);
  const healthyBody: unknown = await healthy.json();
  expect(healthyBody).toEqual(expect.objectContaining({
    startedAtMs: expect.any(Number), running: 0, waiting: 0, voiceSessions: 0, draining: false,
  }));
  expect(healthyBody).toHaveProperty('release');

  await send(page, 'ARMY_SLOW bridge drain survived');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  await expect.poll(async () => {
    const response = await fetch(`${origin}/health`, { headers });
    if (!response.ok) return -1;
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'running' in body && typeof body.running === 'number'
      ? body.running : -1;
  }, { timeout: 5000, message: 'the real ACP turn is in the active Turn registry' }).toBe(1);

  const callsPath = join(bridge.dir, 'army-acp-calls.jsonl');
  const callsBeforeDrain = await readFile(callsPath, 'utf8');
  expect(callsBeforeDrain).toContain('session/new');
  const drainStarted = Date.now();
  const accepted = await fetch(`${origin}/drain`, { method: 'POST', headers });
  expect(accepted.status).toBe(202);
  const inDrain = await fetch(`${origin}/health`, { headers });
  expect(inDrain.status).toBe(200);
  const drainBody: unknown = await inDrain.json();
  expect(drainBody).toEqual(expect.objectContaining({
    draining: true, running: 1, waiting: 0, voiceSessions: 0,
  }));

  // A second authenticated socket exercises the real WS admission path. No ACP
  // session/new may be added, even while the original chat is still streaming.
  const rejected = await page.evaluate(({ port, token }) => new Promise<string[]>((resolve, reject) => {
    const ids = ['army-drain-denied-chat', 'army-drain-denied-voice'];
    const seen = new Map<string, string>();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('bridge never refused both new turns')); }, 5000);
    socket.onerror = () => { clearTimeout(timeout); reject(new Error('authenticated drain probe WebSocket failed')); };
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'chat', id: ids[0], harness: 'omp', text: 'must not spawn' }));
      socket.send(JSON.stringify({ type: 'voice_begin', id: ids[1], harness: 'omp', mime: 'audio/m4a' }));
    };
    socket.onmessage = event => {
      let payload: unknown;
      try { payload = JSON.parse(String(event.data)); } catch { return; }
      if (typeof payload !== 'object' || payload === null ||
          !('type' in payload) || payload.type !== 'error' ||
          !('id' in payload) || typeof payload.id !== 'string' ||
          !('message' in payload) || typeof payload.message !== 'string' ||
          !ids.includes(payload.id)) return;
      seen.set(payload.id, payload.message);
      if (seen.size === ids.length) {
        clearTimeout(timeout);
        socket.close();
        resolve(ids.map(id => seen.get(id) ?? ''));
      }
    };
  }), { port: bridge.port, token });
  expect(rejected).toEqual([RESTART_MESSAGE, RESTART_MESSAGE]);
  expect(await readFile(callsPath, 'utf8')).toBe(callsBeforeDrain);
  await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW bridge drain survived/).first()).toBeVisible({ timeout: 12000 });
  await expect.poll(() => bridge.exitCode(), { timeout: 15000, message: 'drained bridge exits with code 0' }).toBe(0);
  expect(Date.now() - drainStarted).toBeLessThan(15000);
  expect(bridge.logs()).toContain('bridge.stopped');
});
