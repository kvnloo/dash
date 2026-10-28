// GET /chats, /chats/search, /chats/history, /chats/message. Header-only auth;
// every database read happens in a chat-index worker via ChatIndexClient.
import {
  parseChatListQuery, parseChatSearchQuery, parseHistoryQuery, type ChatPage, type ChatSearchHit, type ChatSearchPage, type ChatSummary,
  type HistoryPage,
} from "../../../shared/protocol";
import { decodeCursor } from "../../../shared/protocol";
import { remoteHostFor } from "../remote-hosts";
import { remoteClaudeHistory } from "../remote-history";
import { AbortedError, BusyError, RpcError, type ChatIndexClient } from "./client";
import { filterHash, hash, normalizeQuery, queryHash, SELF_HOST } from "./query";
import { msgCursor, readSearchCursor, titleCursor, withEmitted, type MsgPositions } from "./worker";
import { EngineError } from "./worker";

export interface SelfIdentity { id: string; name: string; matches(hostId: string): boolean }

export interface ChatsHttpOptions {
  /** Header-only credential check (never `?token=`). */
  authorize(request: Request): Promise<boolean>;
  client: ChatIndexClient;
  self(): SelfIdentity;
  /** Live rows (running, openIn) on this host, already keyed with chatKey. A few dozen at most. */
  live(): ChatSummary[];
}

type Json = Record<string, unknown>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const fail = (status: number, code: string, field?: string, extra: Json = {}) => json({ ok: false, code, ...(field ? { field } : {}), ...extra }, status);

/** Merge live rows into page 1 by activity; index rows with a live key take its flags. */
export function overlayLive(items: ChatSummary[], live: ChatSummary[]): ChatSummary[] {
  const byKey = new Map(live.map(row => [row.key, row]));
  const merged = items.map(item => {
    const hit = byKey.get(item.key);
    if (!hit) return item;
    byKey.delete(item.key);
    return { ...item, ...(hit.model ? { model: hit.model } : {}), ...(hit.running ? { running: true } : {}), ...(hit.openIn ? { openIn: hit.openIn } : {}), lastActivityAt: Math.max(item.lastActivityAt, hit.lastActivityAt) };
  });
  return [...merged, ...byKey.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Public host id -> sidecar host id. */
function internalHost(self: SelfIdentity, host: string): string { return self.matches(host) ? SELF_HOST : host; }

/** Public chat key -> sidecar key; undefined for hosts this bridge cannot serve. */
export function internalChatKey(self: SelfIdentity, key: string): string | undefined {
  if (key.startsWith("machine:")) return key;
  const at = key.indexOf(":");
  if (at <= 0) return undefined;
  return self.matches(key.slice(0, at)) ? `${SELF_HOST}${key.slice(at)}` : undefined;
}

function errorResponse(error: unknown): Response {
  if (error instanceof BusyError) return fail(503, "busy", undefined, { retryAfterMs: error.retryAfterMs });
  if (error instanceof AbortedError) return fail(499, "aborted");
  if (error instanceof RpcError || error instanceof EngineError) {
    if (error.code === "bad_cursor") return fail(400, "bad_cursor", error.field);
    if (error.code === "bad_request") return fail(400, "bad_request", error.field);
    if (error.code === "not_found") return fail(404, "not_found");
    if (error.code === "busy") return fail(503, "busy", undefined, { retryAfterMs: 500 });
  }
  return fail(500, "internal");
}

export function createChatsHttpHandler(options: ChatsHttpOptions) {
  const { client } = options;

  async function list(request: Request, url: URL): Promise<Response> {
    const query = parseChatListQuery(url.searchParams);
    if ("error" in query) return fail(400, query.error, query.field);
    const self = options.self();
    const fh = filterHash(query);
    const value = await client.list({ limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}), fh, kinds: query.kinds, hosts: query.hosts.map(h => internalHost(self, h)), chatable: query.chatable, self: { id: self.id, name: self.name } }, request.signal);
    const live = options.live().filter(row => (!query.kinds.length || query.kinds.includes(row.kind)) && (!query.hosts.length || query.hosts.some(h => self.matches(h))) && (!query.chatable || row.chatable));
    const liveKeys = new Set(live.map(row => row.key));
    // Page 1 carries the live overlay; later pages skip those keys so each chat appears once.
    const items = query.cursor ? value.items.filter(item => !liveKeys.has(item.key)) : overlayLive(value.items, live);
    const page: ChatPage = { items, next: value.next, rev: value.rev };
    const headers: Record<string, string> = {};
    if (value.building) headers["X-Dash-Index"] = "building";
    else {
      const etag = `W/"${value.rev}-${hash(url.search + (query.cursor ? "" : JSON.stringify(live)))}"`;
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
      headers.ETag = etag;
      headers["Cache-Control"] = "no-cache";
    }
    return json(page, 200, headers);
  }

  async function search(request: Request, url: URL): Promise<Response> {
    const query = parseChatSearchQuery(url.searchParams);
    if ("error" in query) return fail(400, query.error, query.field);
    const self = options.self();
    const filters = { kinds: query.kinds, hosts: query.hosts };
    const qh = queryHash(query.q, filters, query.in);
    const cursor = readSearchCursor(query.cursor, qh);
    const cacheKey = [normalizeQuery(query.q), query.kinds.join(","), query.hosts.join(","), query.in, query.limit, query.cursor ?? "", cursor?.ph === "msg" ? "" : client.rev].join("|");
    const cached = client.searchCache.get(cacheKey);
    if (cached) return json(cached);
    const base = { q: query.q, kinds: query.kinds, hosts: query.hosts.map(h => internalHost(self, h)), self: { id: self.id, name: self.name } };
    let hits: ChatSearchHit[] = [];
    let next: string | null = null;
    let partial = false;
    let msgStart: MsgPositions | "start" | undefined;
    let exclude: string[] = [];
    let degraded = false;
    // Chats earlier pages returned: message hits skip them, so a chat with many matching messages
    // (or one that matched by title) comes back once per search, not once per page.
    const carried = cursor?.emitted ?? [];
    const emitted = () => withEmitted(carried, hits.map(hit => hit.chat.key));
    if (!cursor || cursor.ph === "title") {
      const titles = await client.titleSearch({ ...base, qh, limit: query.limit, ...(cursor?.ph === "title" ? { after: cursor.after } : {}) }, request.signal);
      hits = titles.hits;
      exclude = titles.keys;
      if (titles.next) next = titleCursor(qh, titles.next, emitted());
      else if (query.in === "all") msgStart = "start";
    } else msgStart = cursor.positions;
    if (msgStart !== undefined) {
      const room = query.limit - hits.length;
      if (room <= 0) next = msgCursor(qh, msgStart, emitted());
      else {
        try {
          const messages = await client.msgSearch({ ...base, limit: room, positions: msgStart, exclude, excludeHashes: carried }, request.signal);
          hits = [...hits, ...messages.hits];
          partial = messages.partial;
          next = messages.next ? msgCursor(qh, messages.next, emitted()) : null;
        } catch (error) {
          // A slow content scan must not cost the title hits: return them, partial, resuming the scan.
          if (!(error instanceof BusyError) || hits.length === 0) throw error;
          partial = true;
          degraded = true;
          next = msgCursor(qh, msgStart, emitted());
        }
      }
    }
    const page: ChatSearchPage = { hits, next, partial };
    if (!degraded) client.searchCache.set(cacheKey, page);
    return json(page);
  }

  async function history(request: Request, url: URL): Promise<Response> {
    const query = parseHistoryQuery(url.searchParams);
    if ("error" in query) return fail(400, query.error, query.field);
    const self = options.self();
    let target: { key: string } | { kind: string; sessionId: string; host: string; profile?: string };
    if (query.key !== undefined) {
      const key = internalChatKey(self, query.key);
      if (!key) return fail(404, "not_found");
      target = { key };
    } else {
      const host = query.host ?? self.id;
      if (!self.matches(host) && !host.startsWith("machine:")) return fail(404, "not_found");
      target = { kind: query.kind ?? "", sessionId: query.sessionId ?? "", host: internalHost(self, host), ...(query.profile ? { profile: query.profile } : {}) };
    }
    const keyed = query.key ? /^(machine:[^:]+):claude:([A-Za-z0-9_-]+)$/.exec(query.key) : undefined;
    const host = remoteHostFor(keyed?.[1] ?? (query.kind === "claude" ? query.host : undefined));
    const session = keyed?.[2] ?? query.sessionId;
    const live = host && session ? await remoteClaudeHistory(host, session, query.limit, query.before) : undefined;
    // Native byte cursors cannot be interpreted as archive ordinals after a failed SSH read.
    const archiveBefore = query.before && !decodeCursor(query.before)?.remote ? query.before : undefined;
    const value = live ?? await client.history({ ...target, limit: query.limit, ...(archiveBefore ? { before: archiveBefore } : {}), self: { id: self.id, name: self.name } }, request.signal);
    const page: HistoryPage = { messages: value.messages, before: value.before };
    return json(page, 200, query.before ? { "Cache-Control": "private, max-age=300" } : {});
  }

  async function message(request: Request, url: URL): Promise<Response> {
    const rawKey = url.searchParams.get("key");
    const id = url.searchParams.get("id");
    if (!rawKey || rawKey.length > 512) return fail(400, "bad_request", "key");
    if (!id || !/^(?:av:\d{1,18}|hz:[A-Za-z0-9_-]{1,64}:\d{1,18}|\d{1,18})$/.test(id)) return fail(400, "bad_request", "id");
    const key = internalChatKey(options.self(), rawKey);
    if (!key) return fail(404, "not_found");
    return json({ message: await client.message({ key, id }, request.signal) });
  }

  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const route = url.pathname === "/chats" ? list : url.pathname === "/chats/search" ? search : url.pathname === "/chats/history" ? history : url.pathname === "/chats/message" ? message : undefined;
    if (!route) return null;
    if (!(await options.authorize(request))) return fail(401, "unauthorized");
    if (request.method !== "GET") return fail(405, "method_not_allowed");
    try {
      return await route(request, url);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
