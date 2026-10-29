import { createServer, request, type ServerResponse, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, createBridge, pair, type Bridge } from './fixtures';

// A real TCP/HTTP relay: payloads and errors come unmodified from isolated bridges.
// Only delivery timing is controlled; no Playwright routes or application setters.
async function relay(bridge: Bridge) {
  let hold: 'none' | 'all' | 'tail' = 'none';
  const waiting: { response: ServerResponse; status: number; headers: IncomingHttpHeaders; body: Buffer }[] = [];
  const requests: string[] = [];
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? '/';
    requests.push(path);
    const upstream = request({ host: '127.0.0.1', port: bridge.port, path, method: incoming.method, headers: { ...incoming.headers, host: `127.0.0.1:${bridge.port}` } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const result = { response: outgoing, status: response.statusCode ?? 502, headers: response.headers, body: Buffer.concat(chunks) };
        const url = new URL(path, 'http://localhost');
        if (hold !== 'none' && url.pathname === '/chats' && (hold === 'all' || url.searchParams.has('cursor'))) waiting.push(result);
        else { outgoing.writeHead(result.status, result.headers); outgoing.end(result.body); }
      });
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  server.on('upgrade', (incoming, socket, head) => {
    const upstream = connect(bridge.port, '127.0.0.1', () => {
      const headers = [...incoming.rawHeaders];
      for (let i = 0; i < headers.length; i += 2) if (headers[i].toLowerCase() === 'host') headers[i + 1] = `127.0.0.1:${bridge.port}`;
      upstream.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${headers.reduce((text, value, index) => text + value + (index % 2 ? '\r\n' : ': '), '')}\r\n`);
      upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Relay did not bind TCP');
  return {
    bridge: { ...bridge, port: address.port }, requests, waiting,
    hold(tailsOnly = false) { hold = tailsOnly ? 'tail' : 'all'; },
    release() { hold = 'none'; for (const item of waiting.splice(0)) { item.response.writeHead(item.status, item.headers); item.response.end(item.body); } },
    async close() { this.release(); server.closeAllConnections(); server.close(); },
  };
}

async function indexedBridge(label: string) {
  return createBridge(false, { env: { ARMY_INDEX_LABEL: label } });
}

test('chat index endpoint replacement rejects held old HTTP heads and persists only its account scope', async ({ page }, info) => {
  test.setTimeout(120000);
  const a = await indexedBridge('OLD');
  const b = await indexedBridge('NEW');
  const proxy = await relay(a);
  try {
    await pair(page, a);
    await expect(page.getByText(/ARMY index OLD/).first()).toBeVisible({ timeout: 30000 });
    proxy.hold();
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${proxy.bridge.port}`);
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    await expect.poll(() => proxy.waiting.length, { timeout: 45000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${b.port}`);
    await page.getByLabel('Token', { exact: true }).fill((await readFile(join(b.dir, '.dash', 'token'), 'utf8')).trim());
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    await expect(page.getByTestId('chats-pane')).toBeVisible();
    await expect(page.getByText(/ARMY index NEW/).first()).toBeVisible({ timeout: 30000 });
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/chats' && new URL(response.url()).port === String(proxy.bridge.port));
    proxy.release();
    await completed;
    await expect(page.getByText(/ARMY index NEW/).first()).toBeVisible();
    await expect(page.getByText(/ARMY index OLD/)).toHaveCount(0);
    // A cold reload uses the saved settings + scoped disk head, not A's late save.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab').nth(1).click();
    await expect(page.getByText(/ARMY index NEW/).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/ARMY index OLD/)).toHaveCount(0);
    await writeFile(info.outputPath('index-http-ordering.json'), JSON.stringify({ heldOldHeads: proxy.requests.filter(path => new URL(path, 'http://localhost').pathname === '/chats').length, oldBridgeLog: a.logs(), newBridgeLog: b.logs() }, null, 2));
  } finally { await proxy.close(); await a.dispose(); await b.dispose(); }
});

test('chat index head refresh supersedes a held tail even when its opaque cursor is unchanged', async ({ page }, info) => {
  test.setTimeout(120000);
  const bridge = await indexedBridge('TAIL');
  const proxy = await relay(bridge);
  try {
    proxy.hold(true);
    await pair(page, bridge);
    await expect(page.getByText(/ARMY index TAIL/).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${proxy.bridge.port}`);
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    await expect(page.getByText(/ARMY index TAIL/).first()).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chats-pane').hover();
    await page.mouse.wheel(0, 20000);
    await expect.poll(() => proxy.waiting.length, { timeout: 20000 }).toBeGreaterThan(0);
    const initialTail = proxy.requests.find(path => new URL(path, 'http://localhost').searchParams.has('cursor'));
    if (!initialTail) throw Error('No real cursor request was held');
    // The app's existing focused-list timer drives the refresh, not an internal setter.
    // An unchanged index returns 304 and legitimately retains this exact tail cursor.
    const refreshed = await page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.port === String(proxy.bridge.port) && url.pathname === '/chats' && !url.searchParams.has('cursor');
    }, { timeout: 45000 });
    expect(refreshed.status()).toBe(304);
    const delivered = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.port === String(proxy.bridge.port) && url.searchParams.has('cursor');
    });
    proxy.release();
    await delivered;
    await page.mouse.wheel(0, 20000);
    // The superseded response cannot exhaust the current list; pagination must issue
    // a fresh real HTTP request for the still-valid cursor and admit that response.
    await expect.poll(() => proxy.requests.filter(path => path === initialTail).length, { timeout: 20000 }).toBeGreaterThan(1);
    await expect(page.getByText(/ARMY index TAIL/).first()).toBeVisible();
    await writeFile(info.outputPath('index-tail-ordering.json'), JSON.stringify({ requests: proxy.requests, refreshedStatus: refreshed.status() }, null, 2));
  } finally { await proxy.close(); await bridge.dispose(); }
});
