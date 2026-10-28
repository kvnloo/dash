// Loopback-only z0live broker for the real Expo web + real bridge tester army.
// Records requests without recording bearer secrets. No remote service or model.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';

export interface VoiceBrokerCall { method: string; path: string; body: unknown; authorized: boolean }
export interface FixtureZ0liveBroker {
  origin: string;
  calls(): readonly VoiceBrokerCall[];
  authorize(token: string): void;
  stop(): Promise<void>;
}
type InboxMessage = { id: string; session_id: string; params: Record<string, never>; say: string };
type QueuedMessage = { cursor: number; message: InboxMessage };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function headers(origin?: string): Record<string, string> {
  return {
    'cache-control': 'no-store',
    ...(origin ? {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      vary: 'Origin',
    } : {}),
  };
}
function json(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  response.writeHead(status, { ...headers(origin), 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function startFixtureZ0liveBroker(): Promise<FixtureZ0liveBroker> {
  const calls: VoiceBrokerCall[] = [];
  const queued: QueuedMessage[] = [];
  const sessionId = 'army-z0live-' + randomUUID();
  const providerSecret = 'army-fake-provider-secret';
  let allowedToken = '';
  let cursor = 0;
  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname + url.search;
    const origin = request.headers.origin;
    const cors = typeof origin === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? origin : undefined;
    if (method === 'OPTIONS') {
      calls.push({ method, path, body: null, authorized: false });
      response.writeHead(204, headers(cors));
      response.end();
      return;
    }
    try {
      let raw = '';
      for await (const chunk of request) {
        raw += String(chunk);
        if (raw.length > 65536) { json(response, 413, { error: 'too large' }, cors); return; }
      }
      let body: unknown = undefined;
      if (raw) {
        if (url.pathname === '/v1/fake/answer') body = raw;
        else {
          try { body = JSON.parse(raw); }
          catch { json(response, 400, { error: 'invalid JSON' }, cors); return; }
        }
      }
      const provider = url.pathname === '/v1/fake/answer';
      const authorized = request.headers.authorization === 'Bearer ' + (provider ? providerSecret : allowedToken) &&
        (provider || allowedToken.length > 0);
      calls.push({ method, path, body, authorized });
      if (!authorized) { json(response, 401, { error: 'invalid fixture token' }, cors); return; }
      if (method === 'POST' && url.pathname === '/v1/realtime/session') {
        if (!record(body) || body.client !== 'dash' || !Array.isArray(body.transports) ||
            !body.transports.includes('realtime') || !record(body.context) ||
            !record(body.context.hermes_target) || typeof body.context.hermes_target.session !== 'string' ||
            typeof body.context.hermes_target.profile !== 'string') {
          json(response, 400, { error: 'invalid session request' }, cors); return;
        }
        json(response, 200, { session_id: sessionId, value: providerSecret, transport: 'realtime' }, cors);
        return;
      }
      if (method === 'GET' && url.pathname === '/v1/inbox') {
        const rawAfter = url.searchParams.get('after');
        if (!rawAfter || !/^\d+$/.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter))) {
          json(response, 400, { error: 'invalid cursor' }, cors); return;
        }
        const after = Number(rawAfter);
        const items = queued.filter(item => item.cursor > after).slice(0, 20);
        const next = items.length ? items[items.length - 1].cursor : after;
        json(response, 200, {
          messages: items.map(item => item.message),
          after: next,
          has_more: queued.some(item => item.cursor > next),
        }, cors);
        return;
      }
      if (method === 'POST' && url.pathname === '/v1/events' && Array.isArray(body)) {
        // Intentional transient broker outage: the phone must keep the call alive after 500.
        if (body.some((item: unknown) => record(item) && item.type === 'assistant_transcript')) {
          json(response, 500, { error: 'fixture assistant transcript telemetry unavailable' }, cors); return;
        }
        json(response, 200, { ok: true }, cors); return;
      }
      if (method === 'POST' && url.pathname === '/v1/tools/ask_z0') {
        if (!record(body) || body.session_id !== sessionId || typeof body.call_id !== 'string' ||
            !record(body.arguments) || typeof body.arguments.question !== 'string') {
          json(response, 400, { error: 'invalid ask_z0' }, cors); return;
        }
        const next = ++cursor;
        queued.push({ cursor: next, message: { id: 'army-reply-' + next, session_id: sessionId, params: {}, say: 'ARMY voice reply' } });
        json(response, 200, { ok: true }, cors);
        return;
      }
      if (method === 'POST' && url.pathname === '/v1/tools/cancel_work' &&
          record(body) && body.session_id === sessionId) {
        json(response, 200, { ok: true }, cors); return;
      }
      if (method === 'POST' && url.pathname === '/v1/sessions/' + encodeURIComponent(sessionId) + '/end') {
        json(response, 200, { ok: true }, cors); return;
      }
      if (method === 'POST' && provider && typeof body === 'string' && body.startsWith('v=0')) {
        response.writeHead(200, { ...headers(cors), 'content-type': 'application/sdp' });
        response.end('v=0 fake'); return;
      }
      json(response, 404, { error: 'not found' }, cors);
    } catch {
      if (!response.headersSent) json(response, 500, { error: 'fixture broker failure' }, cors);
      else response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw Error('No z0live fixture TCP port'); }
  return {
    origin: 'http://127.0.0.1:' + address.port,
    calls: () => calls,
    authorize: token => { allowedToken = token; },
    stop: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())),
  };
}
