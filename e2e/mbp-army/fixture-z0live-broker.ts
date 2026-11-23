// Loopback-only z0live broker for the real Expo web + real bridge tester army.
// Records requests without recording bearer secrets. No remote service or model.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface VoiceBrokerCall { method: string; path: string; body: unknown; authorized: boolean; /** Date.now() when the request arrived. */ at?: number }
/**
 * Two z0live lanes behind ask_z0 (DA-024): a small fast model answers small talk, a large meta
 * model takes task asks into the attached Hermes session. The model delays live here, at the
 * broker boundary the app talks to, never in the app. Lane records go to the session JSONL the
 * bridge folds into the Voice screen's lane timeline (`DASH_Z0LIVE_SESSIONS`).
 */
export interface FixtureLanes {
  sessionsDir: string;
  /** Time to the fast model's first token after the ask reaches the broker. */
  fastFirstTokenMs: number;
  /** Time for the meta lane to hand back a task result. */
  metaMs: number;
}
/** The broker's routing trace: one entry per ask, which lane took it and when its answer was ready and fetched. */
export interface BrokerRoute {
  callId: string;
  question: string;
  lane: 'fast' | 'meta';
  /** The Hermes target the call was minted for: the chat that was open when voice started. */
  target: { profile: string; session: string };
  askedAt: number;
  readyAt?: number;
  /** First inbox response that carried the answer to the app. */
  fetchedAt?: number;
}
/** Task asks (code, tests, PRs) go to the meta lane; everything else is small talk for the fast lane. */
export function routeLane(question: string): 'fast' | 'meta' {
  return /\b(fix|code|test|tests|bug|refactor|implement|build|merge|pr|diff|deploy|commit|branch|run)\b/i.test(question) ? 'meta' : 'fast';
}
export interface FixtureZ0liveBroker {
  origin: string;
  calls(): readonly VoiceBrokerCall[];
  authorize(token: string): void;
  /** Hold the provider's SDP answer (the call stays connecting) until the returned release() is called. */
  holdAnswer(): () => void;
  /** Routing trace (only with lanes). */
  routes(): readonly BrokerRoute[];
  /** The z0live session id this broker minted (its JSONL is `<sessionsDir>/<id>.jsonl`). */
  sessionId: string;
  stop(): Promise<void>;
}
type InboxMessage = { id: string; session_id: string; params: Record<string, string>; say: string };
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

export async function startFixtureZ0liveBroker(options: { lanes?: FixtureLanes } = {}): Promise<FixtureZ0liveBroker> {
  const calls: VoiceBrokerCall[] = [];
  const queued: QueuedMessage[] = [];
  const routes: BrokerRoute[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let target = { profile: '', session: '' };
  const sessionId = 'army-z0live-' + randomUUID();
  const providerSecret = 'army-fake-provider-secret';
  let allowedToken = '';
  let cursor = 0;
  let answerHeld: Promise<void> = Promise.resolve();
  let releaseHeld = () => {};
  const lanes = options.lanes;
  const trace = (type: string, data: Record<string, unknown>) => {
    if (!lanes) return;
    mkdirSync(lanes.sessionsDir, { recursive: true });
    appendFileSync(join(lanes.sessionsDir, sessionId + '.jsonl'), JSON.stringify({ type, ts: Date.now() / 1000, data }) + '\n');
  };
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); run(); }, ms);
    timers.add(timer);
  };
  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname + url.search;
    const origin = request.headers.origin;
    const cors = typeof origin === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? origin : undefined;
    if (method === 'OPTIONS') {
      calls.push({ method, path, body: null, authorized: false, at: Date.now() });
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
      calls.push({ method, path, body, authorized, at: Date.now() });
      if (!authorized) { json(response, 401, { error: 'invalid fixture token' }, cors); return; }
      if (method === 'POST' && url.pathname === '/v1/realtime/session') {
        if (!record(body) || body.client !== 'dash' || !Array.isArray(body.transports) ||
            !body.transports.includes('realtime') || !record(body.context) ||
            !record(body.context.hermes_target) || typeof body.context.hermes_target.session !== 'string' ||
            typeof body.context.hermes_target.profile !== 'string') {
          json(response, 400, { error: 'invalid session request' }, cors); return;
        }
        target = { profile: body.context.hermes_target.profile, session: body.context.hermes_target.session };
        trace('app_state', { source: 'connected' });
        trace('lane_attached', { lane: 'fast', name: 'Fast', model: 'army-fast-mini' });
        trace('lane_attached', { lane: 'meta', name: 'Meta', model: 'army-meta-large' });
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
        const now = Date.now();
        for (const item of items) {
          const route = routes.find(entry => entry.callId === item.message.params.call_id);
          if (route && route.fetchedAt === undefined) route.fetchedAt = now;
        }
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
        if (!lanes) {
          const next = ++cursor;
          queued.push({ cursor: next, message: { id: 'army-reply-' + next, session_id: sessionId, params: {}, say: 'ARMY voice reply' } });
          json(response, 200, { ok: true }, cors);
          return;
        }
        const question = body.arguments.question;
        const callId = body.call_id;
        const lane = routeLane(question);
        const route: BrokerRoute = { callId, question, lane, target, askedAt: Date.now() };
        routes.push(route);
        trace('lane_step', { lane, step: lane === 'fast' ? 'Answering: ' + question : 'Taking it to session ' + target.session });
        later(lane === 'fast' ? lanes.fastFirstTokenMs : lanes.metaMs, () => {
          const say = lane === 'fast' ? 'FAST ' + question : 'META done in session ' + target.session;
          const next = ++cursor;
          queued.push({ cursor: next, message: { id: 'army-reply-' + next, session_id: sessionId, params: { lane, call_id: callId }, say } });
          route.readyAt = Date.now();
          trace('lane_handoff', { lane, summary: say });
        });
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
        await answerHeld;
        response.writeHead(200, { ...headers(cors), 'content-type': 'application/sdp' });
        response.end('v=0 fake'); return;
      }
      json(response, 404, { error: 'not found' }, cors);
    } catch {
      if (!response.headersSent) json(response, 500, { error: 'fixture broker failure' }, cors);
      else response.end();
    }
  });
  server.listen(Number(process.env.ARMY_VOICE_PORT ?? 0), '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw Error('No z0live fixture TCP port'); }
  return {
    origin: 'http://127.0.0.1:' + address.port,
    calls: () => calls,
    authorize: token => { allowedToken = token; },
    routes: () => routes,
    sessionId,
    holdAnswer: () => {
      answerHeld = new Promise<void>(resolve => { releaseHeld = resolve; });
      return () => releaseHeld();
    },
    // A held answer is released first: an open request would keep close() waiting.
    stop: () => {
      releaseHeld();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      return new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
