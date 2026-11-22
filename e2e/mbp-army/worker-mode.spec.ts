import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { parseServerMessage, type NoticeMessage } from '../../shared/protocol';

// Android's shade is device-only. Drive the exact mode frames the tile's
// native client sends against the real authenticated bridge and report ingress.
test('Me mode makes live and replayed reports silent without muting other sockets', async ({ bridge }, info) => {
  const token = (await readFile(join(bridge.dir, '.dash/token'), 'utf8')).trim();
  const ingress = /^\s*notices\s+(\S+\/notice)\s/m.exec(bridge.logs())?.[1];
  if (!ingress) throw new Error('Bridge report ingress missing');
  const url = new URL(ingress);
  url.protocol = 'ws:';
  url.port = String(bridge.port);
  url.pathname = '/ws';
  url.searchParams.set('token', token);

  const sockets: WebSocket[] = [];
  async function connect(me = false) {
    const endpoint = new URL(url);
    if (me) endpoint.searchParams.set('notice_mode', 'me');
    const socket = new WebSocket(endpoint);
    sockets.push(socket);
    const reports = new Map<string, NoticeMessage>();
    let hello = false;
    let pongs = 0;
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const raw: unknown = JSON.parse(event.data);
      if (event.data === '{"type":"pong"}') pongs++;
      const parsed = parseServerMessage(raw);
      if (parsed?.type === 'hello') hello = parsed.features?.includes('notice-mode.v1') === true;
      if (parsed?.type === 'notice') reports.set(parsed.title, parsed);
    });
    await expect.poll(() => hello).toBe(true);
    return {
      reports,
      async setMode(mode: 'worker' | 'me') {
        const next = pongs + 1;
        socket.send(JSON.stringify({ type: 'notice_mode', mode }));
        socket.send(JSON.stringify({ type: 'ping' }));
        await expect.poll(() => pongs).toBe(next);
      },
    };
  }
  async function report(title: string) {
    const response = await fetch(ingress, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body: 'ARMY report body' }),
    });
    expect(response.status).toBe(201);
  }
  async function silent(client: Awaited<ReturnType<typeof connect>>, title: string) {
    await expect.poll(() => client.reports.has(title)).toBe(true);
    return client.reports.get(title)?.silent === true;
  }

  try {
    const phone = await connect();
    const other = await connect();
    await report('Before switching');
    expect(await silent(phone, 'Before switching')).toBe(false);
    await phone.setMode('me');
    await report('While in Me mode');
    expect(await silent(phone, 'While in Me mode')).toBe(true);
    expect(await silent(other, 'While in Me mode')).toBe(false);

    const restarted = await connect(true);
    expect(await silent(restarted, 'Before switching')).toBe(true);
    expect(await silent(restarted, 'While in Me mode')).toBe(true);
    await restarted.setMode('worker');
    await report('Back in Worker mode');
    expect(await silent(restarted, 'Back in Worker mode')).toBe(false);
    expect(await silent(phone, 'Back in Worker mode')).toBe(true);
    await info.attach('inbox-delivery', {
      body: JSON.stringify([...restarted.reports.values()]), contentType: 'application/json',
    });
  } finally {
    for (const socket of sockets) socket.close();
  }
});
