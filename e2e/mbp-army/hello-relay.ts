import { createInterface } from 'node:readline';

type Peer = { id: number; upstream?: WebSocket; queue: string[] };
const upstream = new URL(process.argv[2]);
let withholding = true;
let nextId = 0;
let holdNextRoster = false;
let releaseRoster: (() => void) | undefined;
const peers = new Set<WebSocket>();
const report = (event: string, id = 0) => console.log(JSON.stringify({ event, id, at: Date.now() }));
const server = Bun.serve<Peer>({
  hostname: '127.0.0.1', port: 0,
  async fetch(request, server) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, upstream);
    const headers = new Headers(request.headers);
    headers.set('host', upstream.host);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const data: Peer = { id: ++nextId, queue: [] };
      if (!server.upgrade(request, { data })) return new Response('Upgrade failed', { status: 400 });
      target.protocol = 'ws:';
      const remote = new WebSocket(target, { headers });
      data.upstream = remote;
      peers.add(remote);
      remote.onopen = () => {
        report('upstream-open', data.id);
        for (const frame of data.queue.splice(0)) remote.send(frame);
      };
      remote.onmessage = event => {
        const frame = String(event.data);
        const message: unknown = JSON.parse(frame);
        if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'hello') {
          report('authenticated-hello', data.id);
          if (withholding) { report('withheld-hello', data.id); return; }
        }
        const client = clients.get(data.id);
        if (client) client.send(frame);
      };
      remote.onclose = () => { peers.delete(remote); clients.get(data.id)?.close(); };
      return;
    }
    const holdRoster = request.method === 'GET' && url.pathname === '/roster' && holdNextRoster;
    if (holdRoster) {
      holdNextRoster = false;
      server.timeout(request, 0);
      // Capture a complete real snapshot, not a conditional cache confirmation.
      headers.delete('if-none-match');
    }
    const response = await fetch(target, { method: request.method, headers, body: request.body, redirect: 'manual' });
    if (!holdRoster) return response;
    // Delay the real authenticated response, without changing its roster bytes.
    if (response.status !== 200) throw Error(`Roster snapshot returned ${response.status}`);
    const body = await response.arrayBuffer();
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-army-held-roster', '1');
    responseHeaders.set('access-control-expose-headers', 'ETag, X-Army-Held-Roster');
    responseHeaders.set('cache-control', 'no-store');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseRoster = () => {
          controller.enqueue(new Uint8Array(body));
          controller.close();
          report(`roster-released:${response.status}`);
        };
        report('roster-held');
      },
    });
    // Send no-store headers now so a newer request is not coalesced behind this
    // deliberately delayed body. The selected request lives until explicit release.
    return new Response(stream, { status: response.status, headers: responseHeaders });
  },
  websocket: {
    open(client) { clients.set(client.data.id, client); report('client-open', client.data.id); },
    message(client, frame) {
      const text = String(frame);
      const remote = client.data.upstream;
      if (remote?.readyState === WebSocket.OPEN) remote.send(text);
      else client.data.queue.push(text);
    },
    close(client) {
      report('client-close', client.data.id);
      clients.delete(client.data.id);
      client.data.upstream?.close();
    },
  },
});
const clients = new Map<number, Bun.ServerWebSocket<Peer>>();
report(`listening:${server.port}`);
createInterface({ input: process.stdin }).on('line', command => {
  if (command === 'allow') { withholding = false; report('allow'); }
  if (command === 'hold') { withholding = true; report('hold'); }
  if (command === 'hold-roster') { holdNextRoster = true; report('roster-armed'); }
  if (command === 'release-roster') { releaseRoster?.(); releaseRoster = undefined; }
  if (command === 'disconnect') {
    report('disconnect');
    for (const client of clients.values()) client.close(1000, 'Owned reconnect');
  }
});
process.on('SIGTERM', () => {
  for (const peer of peers) peer.close();
  server.stop(true);
  process.exit(0);
});
