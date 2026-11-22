// Loopback z0bridge `--fx` stand-in for Live surface journeys: one Hermes session, one libfx worker
// attached to it, scripted fx0 turns. Every request must carry the bearer from the token file; every
// request and every receipt "recorded in Hermes" is appended to army-fx.jsonl for the spec to read.
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { LiveControl, LiveReceipt } from '../../shared/live';

export interface FixtureFx { env: Record<string, string>; log: string; stop(): Promise<void> }

type Meta = { version: number; bytes: number; sha256: string; createdAt: number; title: string };
type Event = { type: string; [key: string]: unknown };

export const FX_CONTROL: LiveControl = {
  id: 'layout', kind: 'choice', prompt: 'Pick a layout for the dashboard',
  options: [{ id: 'grid', label: 'Grid layout', detail: 'Cards in two columns' }, { id: 'list', label: 'List layout', detail: 'One card per row' }],
};
const PREFIX = 'Use the hermes tool to ask Hermes exactly this, then relay its answer in one or two sentences: ';
const design = (version: number, title: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="background:#000;color:#fff;font:14px system-ui"><h1>${title}</h1><p>fx0 design version ${version}</p></body></html>`;

export async function startFixtureFx(dir: string): Promise<FixtureFx> {
  const token = randomBytes(24).toString('base64url');
  const tokenFile = join(dir, 'z0bridge-fx-token');
  await writeFile(tokenFile, token + '\n', { mode: 0o600 });
  const log = join(dir, 'army-fx.jsonl');
  const record = (entry: Record<string, unknown>) => appendFile(log, JSON.stringify({ at: Date.now(), ...entry }) + '\n');
  // The owning Hermes session: the chat's own session when it has one, else one z0bridge creates.
  let hermes = { id: 'army-hermes-live', title: 'ARMY Hermes live chat' };
  let worker: { id: string; parent: { id: string } } | undefined;
  const artifacts: { meta: Meta; html: string }[] = [];
  const receipts: LiveReceipt[] = [];
  const turns = new Map<string, Event[]>();
  let messageId = 4100;
  const addArtifact = (title: string): Meta => {
    const version = artifacts.length + 1, html = design(version, title);
    const meta = { version, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), createdAt: Date.now(), title };
    artifacts.push({ meta, html });
    return meta;
  };
  /** What the owning Hermes session stores: a receipt child row with its own message id. */
  const receipt = (kind: LiveReceipt['kind'], summary: string, decisions: string[]): LiveReceipt => {
    const r: LiveReceipt = { kind, summary, decisions, artifacts: artifacts.slice(-1).map(a => ({ version: a.meta.version, sha256: a.meta.sha256, bytes: a.meta.bytes })), at: Date.now(), hermes: { child: `fxw_${worker?.id ?? 'none'}`, messageId: ++messageId } };
    receipts.push(r);
    void record({ hermesReceipt: r });
    return r;
  };
  addArtifact('Starter dashboard');
  const script = (text: string): Event[] => {
    if (text.startsWith(PREFIX)) {
      const question = text.slice(PREFIX.length);
      return [{ type: 'hermes', phase: 'asking', text: question }, { type: 'hermes', phase: 'answered', text: 'Hermes says the deploy window is Thursday.' },
        { type: 'delta', text: 'Hermes answered: the deploy window is Thursday.' }, { type: 'receipt', receipt: receipt('ask_hermes', `Asked Hermes: ${question}`, []) }, { type: 'done', stopReason: 'end_turn' }];
    }
    const events: Event[] = [{ type: 'status', text: 'thinking' }, { type: 'delta', text: 'Here is a dashboard. ' }];
    if (/control|layout/i.test(text)) events.push({ type: 'control', control: FX_CONTROL });
    events.push({ type: 'artifact', artifact: addArtifact('Dashboard draft') }, { type: 'delta', text: 'Pick a layout and I will apply it.' },
      { type: 'receipt', receipt: receipt('turn', 'Worker drafted a dashboard', []) }, { type: 'done', stopReason: 'end_turn' });
    return events;
  };
  const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let turnSeq = 0;
  const startTurn = (events: Event[]) => { const id = `turn-${++turnSeq}`; turns.set(id, events); return id; };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const authorized = req.headers.authorization === `Bearer ${token}`;
    await record({ method: req.method, path: url.pathname, authorized, ...(body === undefined ? {} : { body }) });
    if (!authorized) return json(res, 401, { error: { message: 'unauthorized' } });
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const route = `${req.method} /${parts.join('/')}`;
    const fx = parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] === 'fx';
    if (route === 'GET /v1/harnesses') return json(res, 200, { harnesses: [{ id: 'fx', version: 'libfx army fixture' }] });
    if (req.method === 'GET' && parts[2] === 'hermes' && parts.length === 5) { hermes = { id: parts[4] ?? hermes.id, title: 'ARMY Hermes chat' }; return json(res, 200, hermes); }
    if (route === 'POST /v1/sessions') {
      const b = body as { harness?: string; parent?: { id: string } };
      if (b.harness === 'hermes') return json(res, 200, hermes);
      if (b.harness === 'fx' && b.parent?.id === hermes.id) { worker = { id: 'fxw-army-1', parent: { id: hermes.id } }; return json(res, 200, worker); }
      return json(res, 400, { error: { message: 'bad session' } });
    }
    if (route === 'GET /v1/sessions') return json(res, 200, { sessions: worker && url.searchParams.get('q') === worker.parent.id ? [{ id: worker.id }] : [] });
    if (fx && worker && parts[4] === worker.id) {
      const rest = parts.slice(5);
      if (req.method === 'GET' && rest.length === 0) return json(res, 200, worker);
      if (req.method === 'GET' && rest[0] === 'artifacts' && rest.length === 1) return json(res, 200, { artifacts: artifacts.map(a => a.meta) });
      if (req.method === 'GET' && rest[0] === 'artifacts' && rest.length === 2) {
        const a = artifacts.find(x => x.meta.version === Number(rest[1]));
        if (!a) return json(res, 404, { error: { message: 'no artifact' } });
        res.writeHead(200, { 'content-type': 'text/html' }); res.end(a.html); return;
      }
      if (req.method === 'POST' && rest[0] === 'turns') return json(res, 200, { turnId: startTurn(script(String((body as { text?: unknown }).text ?? ''))) });
      if (req.method === 'POST' && rest[0] === 'intents') {
        const b = body as { intent: { controlId: string; value: unknown; label?: string }; continue?: boolean };
        const decided = `${b.intent.controlId} = ${b.intent.label ?? String(b.intent.value)}`;
        const r = receipt('intent', `Owner picked ${b.intent.label ?? String(b.intent.value)}`, [decided]);
        const turnId = b.continue ? startTurn([{ type: 'delta', text: `Applied ${b.intent.label ?? String(b.intent.value)}.` }, { type: 'artifact', artifact: addArtifact(`Dashboard · ${b.intent.label ?? 'picked'}`) }, { type: 'done', stopReason: 'end_turn' }]) : undefined;
        return json(res, 200, { receipt: r, ...(turnId ? { turnId } : {}) });
      }
      if (req.method === 'GET' && rest[0] === 'receipts') return json(res, 200, { receipts });
    }
    if (req.method === 'GET' && parts[1] === 'turns' && parts[3] === 'events') {
      const events = turns.get(parts[2] ?? '');
      if (!events) return json(res, 404, { error: { message: 'no turn' } });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      events.forEach((event, i) => res.write(`data: ${JSON.stringify({ seq: i + 1, ...event })}\n\n`));
      res.end(); return;
    }
    // No /v1/health: the bridge's Hermes chat path must stay on the scripted ACP peer.
    return json(res, 404, { error: { message: 'not found' } });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fx fixture has no port');
  return {
    env: { DASH_Z0BRIDGE_URL: `http://127.0.0.1:${address.port}`, DASH_Z0BRIDGE_TOKEN_FILE: tokenFile, DASH_LIVE_HERMES_PROFILE: 'default' },
    log,
    async stop() { server.closeAllConnections(); server.close(); await once(server, 'close').catch(() => undefined); },
  };
}
