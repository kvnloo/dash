// Scripted loopback stand-in for the host z0bridge `--fx` lane, used only by the RC3 area-11 Live surface journeys.
// The real isolated bridge (bridge/src/live-surface.ts @ 2c948dc) talks to it over HTTP exactly as it would
// talk to z0bridge: the app is NOT mocked and no browser route is intercepted. No LLM, no network beyond
// 127.0.0.1, fixture-only bearer (random per test, never a real credential).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export type FxRequest = { method: string; path: string; body?: unknown; authorized: boolean };
export type FxFixture = { url: string; tokenFile: string; requests: FxRequest[]; close(): Promise<void> };

export const FX = {
 parent: 'army-live-parent',
 parentTitle: 'ARMY live parent',
 worker: 'army-fx-worker',
 model: 'army-fx-fixture',
 title: 'ARMY fx0 design',
 control: { id: 'army-layout', kind: 'choice', prompt: 'ARMY pick a layout', options: [{ id: 'grid', label: 'Grid layout' }, { id: 'list', label: 'List layout', detail: 'one column' }] },
 hermesAnswer: 'ARMY_HERMES_ANSWER relayed',
};
const html = (v: number) => `<!doctype html><html><body style="background:#111;color:#eee"><h1>ARMY_FX_V${v}</h1></body></html>`;
const meta = (v: number) => ({ version: v, bytes: html(v).length, sha256: `army-sha-v${v}`, createdAt: 1_760_000_000_000 + v, title: FX.title });

export async function startFxFixture(): Promise<FxFixture> {
 const dir = await mkdtemp(join(process.env.ARMY_TMP || tmpdir(), 'dash-army-fx-'));
 const token = 'army-fx-' + randomBytes(12).toString('hex');
 const tokenFile = join(dir, 'token');
 await writeFile(tokenFile, token + '\n', { mode: 0o600 });
 const requests: FxRequest[] = [];
 let versions = [1, 2];
 let turnSeq = 0;
 const turns = new Map<string, { text: string; ask: boolean }>();
 const receipts: Record<string, unknown>[] = [
  { kind: 'turn', summary: 'ARMY earlier worker turn', decisions: [], artifacts: [], at: 1_760_000_000_001, hermes: { child: 'fxw_army', messageId: 41 } },
  { kind: 'intent', summary: 'ARMY earlier tap', decisions: ['Earlier choice'], artifacts: [], at: 1_760_000_000_002, hermes: { child: 'fxw_army', messageId: 42 } },
 ];
 const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
 const readBody = async (req: IncomingMessage): Promise<unknown> => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (!raw) return undefined; try { return JSON.parse(raw) as unknown; } catch { return raw; }
 };
 const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
 const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const authorized = req.headers.authorization === `Bearer ${token}`;
  const body = await readBody(req);
  requests.push({ method: req.method || 'GET', path: url.pathname + url.search, ...(body === undefined ? {} : { body }), authorized });
  // Health (and anything unknown) is 404: the bridge's Hermes roster must keep using the fixture state.db.
  if (!authorized) return json(res, 401, { error: { message: 'army fx fixture: bad bearer' } });
  const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  // POST /v1/sessions  (hermes parent or fx worker)
  if (req.method === 'POST' && url.pathname === '/v1/sessions') {
   return record.harness === 'fx' ? json(res, 200, { id: FX.worker }) : json(res, 200, { id: FX.parent, title: FX.parentTitle });
  }
  if (req.method === 'GET' && url.pathname === '/v1/sessions') return json(res, 200, { sessions: [] });
  if (req.method === 'GET' && url.pathname === '/v1/harnesses') return json(res, 200, { harnesses: [{ id: 'fx', version: FX.model }] });
  // GET /v1/sessions/hermes/<profile>/<id>
  if (req.method === 'GET' && p[0] === 'v1' && p[1] === 'sessions' && p[2] === 'hermes' && p.length === 5) return json(res, 200, { id: p[4], title: FX.parentTitle });
  if (p[0] === 'v1' && p[1] === 'sessions' && p[2] === 'fx' && p.length >= 5) {
   const rest = p.slice(5);
   if (req.method === 'GET' && rest.length === 0) return json(res, 200, { id: p[4], parent: { id: FX.parent } });
   if (req.method === 'GET' && rest[0] === 'artifacts' && rest.length === 1) return json(res, 200, { artifacts: versions.map(meta) });
   if (req.method === 'GET' && rest[0] === 'artifacts' && rest.length === 2) {
    const v = Number(rest[1]); if (!versions.includes(v)) return json(res, 404, { error: { message: 'no such version' } });
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html(v)); return;
   }
   if (req.method === 'GET' && rest[0] === 'receipts') return json(res, 200, { receipts });
   if (req.method === 'POST' && rest[0] === 'turns') {
    const text = typeof record.text === 'string' ? record.text : '';
    const id = `army-turn-${++turnSeq}`;
    turns.set(id, { text, ask: text.startsWith('Use the hermes tool to ask Hermes exactly this') });
    return json(res, 200, { turnId: id });
   }
   if (req.method === 'POST' && rest[0] === 'intents') {
    const intent = typeof record.intent === 'object' && record.intent !== null ? record.intent as Record<string, unknown> : {};
    const label = typeof intent.label === 'string' ? intent.label : String(intent.value);
    const receipt = { kind: 'intent', summary: `ARMY tap ${label}`, decisions: [label], artifacts: [], at: Date.now(), hermes: { child: 'fxw_army', messageId: 40 + receipts.length + 1 } };
    receipts.push(receipt);
    return json(res, 200, { receipt });
   }
  }
  // GET /v1/turns/<id>/events (SSE)
  if (req.method === 'GET' && p[0] === 'v1' && p[1] === 'turns' && p[3] === 'events') {
   const turn = turns.get(p[2] ?? '');
   if (!turn) return json(res, 404, { error: { message: 'no such turn' } });
   res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
   let seq = 0;
   const emit = async (event: Record<string, unknown>) => { res.write(`data: ${JSON.stringify({ seq: ++seq, ...event })}\n\n`); await wait(120); };
   if (turn.ask) {
    const question = turn.text.replace(/^.*?exactly this, then relay its answer in one or two sentences: /, '');
    await emit({ type: 'hermes', phase: 'asking', text: question });
    await emit({ type: 'hermes', phase: 'answered', text: FX.hermesAnswer });
    await emit({ type: 'delta', text: 'ARMY_FX_RELAY ' + FX.hermesAnswer });
    const receipt = { kind: 'ask_hermes', summary: `ARMY asked Hermes ${question}`, decisions: [], artifacts: [], at: Date.now(), hermes: { child: 'fxw_army', messageId: 40 + receipts.length + 1 } };
    receipts.push(receipt);
    await emit({ type: 'receipt', receipt });
   } else {
    await emit({ type: 'status', text: 'army working' });
    await emit({ type: 'delta', text: 'ARMY_FX_REPLY: ' + turn.text.slice(0, 120) });
    const v = Math.max(...versions) + 1; versions = [...versions, v];
    await emit({ type: 'artifact', artifact: meta(v) });
    await emit({ type: 'control', control: FX.control });
    const receipt = { kind: 'turn', summary: `ARMY worker turn ${turn.text.slice(0, 60)}`, decisions: [], artifacts: [{ version: v, sha256: `army-sha-v${v}`, bytes: html(v).length }], at: Date.now(), hermes: { child: 'fxw_army', messageId: 40 + receipts.length + 1 } };
    receipts.push(receipt);
    await emit({ type: 'receipt', receipt });
   }
   await emit({ type: 'done', stopReason: 'end_turn' });
   res.end(); return;
  }
  return json(res, 404, { error: { message: 'army fx fixture: unknown route' } });
 });
 server.listen(0, '127.0.0.1');
 await once(server, 'listening');
 const { port } = server.address() as AddressInfo;
 return {
  url: `http://127.0.0.1:${port}`, tokenFile, requests,
  async close() { server.closeAllConnections(); server.close(); },
 };
}
