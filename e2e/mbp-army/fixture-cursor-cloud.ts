// Cursor cloud agents API stand-in (the public v0 background-agents API shape), for the army.
// No network beyond 127.0.0.1, no real key: it accepts only the army's fixture key. Each agent
// moves CREATING -> RUNNING -> FINISHED on a timer and answers `ARMY_CURSOR_REPLY: <prompt>`.
import { createServer, type IncomingMessage, type Server } from 'node:http';

export const CURSOR_FIXTURE_KEY = 'army-cursor-fixture-key';
type Message = { id: string; type: 'user_message' | 'assistant_message'; text: string };
type Agent = { id: string; name: string; status: string; source: { repository: string; ref?: string }; target: { url: string; branchName: string }; createdAt: string; messages: Message[] };
export type CursorCall = { method: string; path: string; authorized: boolean; body?: unknown };
export interface CursorFixture { url: string; calls: CursorCall[]; agents: Map<string, Agent>; stop(): Promise<void> }

function record(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function promptText(body: unknown): string { return record(body) && record(body.prompt) && typeof body.prompt.text === 'string' ? body.prompt.text : ''; }
async function readBody(req: IncomingMessage): Promise<unknown> {
 let raw = ''; for await (const chunk of req) raw += String(chunk);
 if (!raw) return undefined; try { return JSON.parse(raw); } catch { return undefined; }
}

export async function startCursorFixture(): Promise<CursorFixture> {
 const agents = new Map<string, Agent>(); const calls: CursorCall[] = []; let n = 0; const timers = new Set<ReturnType<typeof setTimeout>>();
 const later = (ms: number, fn: () => void) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
 const work = (agent: Agent, text: string) => {
  agent.status = 'RUNNING';
  later(700, () => { agent.messages.push({ id: `${agent.id}-a${agent.messages.length}`, type: 'assistant_message', text: 'ARMY_CURSOR_REPLY: ' + text }); agent.status = 'FINISHED'; });
 };
 const view = (a: Agent) => ({ id: a.id, name: a.name, status: a.status, source: a.source, target: a.target, createdAt: a.createdAt });
 const server: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://fixture'); const method = req.method ?? 'GET';
  const body = method === 'POST' ? await readBody(req) : undefined;
  const authorized = req.headers.authorization === `Bearer ${CURSOR_FIXTURE_KEY}`;
  calls.push({ method, path: url.pathname + url.search, authorized, ...(body === undefined ? {} : { body }) });
  const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (!authorized) return json(401, { error: 'Unauthorized' });
  const m = /^\/v0\/agents(?:\/([^/]+))?(?:\/(conversation|followup|stop))?$/.exec(url.pathname);
  if (!m) return json(404, { error: 'Not found' });
  const [, id, action] = m;
  if (!id && method === 'GET') return json(200, { agents: [...agents.values()].reverse().map(view) });
  if (!id && method === 'POST') {
   const text = promptText(body); const source = record(body) && record(body.source) ? body.source : {};
   if (!text || typeof source.repository !== 'string') return json(400, { error: 'prompt.text and source.repository are required' });
   const agentId = `bc_army_${++n}`;
   const agent: Agent = { id: agentId, name: 'ARMY cursor agent ' + n, status: 'CREATING', source: { repository: source.repository, ...(typeof source.ref === 'string' ? { ref: source.ref } : {}) },
    target: { url: `https://cursor.com/agents?id=${agentId}`, branchName: `cursor/army-${n}` }, createdAt: new Date().toISOString(), messages: [{ id: `${agentId}-u0`, type: 'user_message', text }] };
   agents.set(agentId, agent); later(300, () => work(agent, text));
   return json(200, view(agent));
  }
  const agent = id ? agents.get(id) : undefined;
  if (!agent) return json(404, { error: 'Agent not found' });
  if (!action && method === 'GET') return json(200, view(agent));
  if (action === 'conversation' && method === 'GET') return json(200, { id: agent.id, messages: agent.messages });
  if (action === 'followup' && method === 'POST') {
   const text = promptText(body); if (!text) return json(400, { error: 'prompt.text is required' });
   agent.messages.push({ id: `${agent.id}-u${agent.messages.length}`, type: 'user_message', text }); later(300, () => work(agent, text));
   return json(200, { id: agent.id });
  }
  if (action === 'stop' && method === 'POST') { agent.status = 'FINISHED'; return json(200, { id: agent.id }); }
  return json(405, { error: 'Method not allowed' });
 });
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 const address = server.address(); if (!address || typeof address === 'string') throw Error('cursor fixture has no port');
 return { url: `http://127.0.0.1:${address.port}`, calls, agents, stop: () => new Promise<void>(resolve => { for (const t of timers) clearTimeout(t); server.close(() => resolve()); server.closeAllConnections(); }) };
}
