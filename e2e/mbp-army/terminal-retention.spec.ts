import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { test, expect, createBridge, pair } from './fixtures';

test('pending terminal work survives retained-turn cap and explicit subscriber reconnect', async ({ page }, info) => {
  let finalRequest = false;
  const worker = createServer(request => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (body.includes('One or two short lines.')) finalRequest = true;
      // Exercise the real provider deadline, without manufacturing a summary.
    });
  });
  worker.listen(0, '127.0.0.1');
  await once(worker, 'listening');
  const address = worker.address();
  if (!address || typeof address === 'string') throw Error('Summary transport did not bind');
  const bridge = await createBridge(false, { env: { DASH_TINY_URL: `http://127.0.0.1:${address.port}/v1` } });
  const frames: Record<string, unknown>[] = [];
  let socket: WebSocket | undefined;
  let reconnect: WebSocket | undefined;
  const connect = async () => {
    const token = (await readFile(join(bridge.dir, '.dash/token'), 'utf8')).trim();
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws?token=${encodeURIComponent(token)}`);
    ws.addEventListener('message', event => { frames.push(JSON.parse(String(event.data))); });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(Error('Authenticated subscriber connection failed')), { once: true });
    });
    return ws;
  };
  try {
    await writeFile(join(bridge.dir, '.dash/model-roles.yml'), 'modelRoles:\n  smol: local/army-summary\n  tiny: local/army-summary\n');
    await pair(page, bridge);
    socket = await connect();
    socket.send(JSON.stringify({ type: 'chat', id: 'retention-target', harness: 'omp', text: 'ARMY_MS=50 ARMY_TICK=5 retention target', summariesEnabled: true }));
    await expect.poll(() => finalRequest, { timeout: 10000 }).toBe(true);
    expect(frames.some(frame => frame.id === 'retention-target' && frame.type === 'done')).toBe(false);
    // These are real rejected turns, not seeded map entries. Each receives error + done.
    for (let index = 0; index < 50; index++) socket.send(JSON.stringify({ type: 'chat', id: `retention-cap-${index}`, harness: 'omp', mode: 'steer', text: 'Unsupported OMP steer must settle' }));
    await expect.poll(() => frames.filter(frame => typeof frame.id === 'string' && frame.id.startsWith('retention-cap-') && frame.type === 'done').length, { timeout: 5000, intervals: [10] }).toBe(50);
    expect(frames.some(frame => frame.id === 'retention-target' && frame.type === 'done')).toBe(false);
    socket.close();
    frames.length = 0;
    reconnect = await connect();
    reconnect.send(JSON.stringify({ type: 'attach', turns: [{ id: 'retention-target', seq: 0 }] }));
    await expect.poll(() => frames.some(frame => frame.id === 'retention-target' && (frame.type === 'done' || frame.type === 'lost')), { timeout: 5000, intervals: [10] }).toBe(true);
    expect(frames.filter(frame => frame.id === 'retention-target' && frame.type === 'lost')).toHaveLength(0);
    expect(frames.filter(frame => frame.id === 'retention-target' && frame.type === 'done')).toHaveLength(1);
    expect(frames.some(frame => frame.id === 'retention-target' && frame.type === 'delta')).toBe(true);
    frames.length = 0;
    reconnect.send(JSON.stringify({ type: 'attach', turns: [{ id: 'retention-target', seq: 0 }] }));
    await expect.poll(() => frames.some(frame => frame.id === 'retention-target' && frame.type === 'lost'), { timeout: 5000 }).toBe(true);
    expect(frames.some(frame => frame.id === 'retention-target' && frame.type === 'done')).toBe(false);
    await page.screenshot({ path: info.outputPath('final.png') });
  } finally {
    socket?.close();
    reconnect?.close();
    await bridge.dispose();
    worker.closeAllConnections();
    await new Promise<void>(resolve => worker.close(() => resolve()));
    await writeFile(info.outputPath('bridge.log'), bridge.logs());
  }
});
