import {
  parseChatPage,
  parseChatSearchPage,
  parseHistoryPage,
  type ChatPage,
  type ChatSearchPage,
  type HistoryMessage,
  type HistoryPage,
} from "../../../shared/protocol";
import { executionToken, type AuthSettings } from "../lib/bridge-auth";

/** chats.v1 HTTP client: GET /chats, /chats/search, /chats/history, /chats/message. */

export type ApiResult<T> =
  | { ok: true; value: T; etag?: string; building?: boolean }
  | { ok: false; notModified: true }
  | { ok: false; notModified?: false; status: number; code: string; retryAfterMs?: number; aborted?: boolean };

export interface ApiSettings extends AuthSettings { address: string; chatIndexScope?: string }

export interface ChatListParams { limit?: number; cursor?: string | null; kinds?: readonly string[]; hosts?: readonly string[]; chatable?: boolean }
export interface ChatSearchParams { q: string; limit?: number; cursor?: string | null; kinds?: readonly string[]; hosts?: readonly string[]; in?: "all" | "titles" }
export interface HistoryParams { key: string; before?: string | null; limit?: number }

export interface ChatsApiDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
    ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>;
  }>;
  token: (settings: ApiSettings) => Promise<string>;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function csv(values: readonly string[] | undefined): string | undefined {
  return values && values.length ? values.join(",") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

export function createChatsApi(deps: ChatsApiDeps) {
  async function get<T>(settings: ApiSettings, path: string, parse: (raw: unknown) => T | null, opts: { signal?: AbortSignal; etag?: string } = {}): Promise<ApiResult<T>> {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${await deps.token(settings)}` };
      if (opts.etag) headers["If-None-Match"] = opts.etag;
      const res = await deps.fetch(`http://${settings.address}${path}`, { method: "GET", headers, signal: opts.signal });
      if (res.status === 304) return { ok: false, notModified: true };
      let raw: unknown;
      try { raw = await res.json(); } catch { raw = undefined; }
      if (!res.ok) {
        const code = isRecord(raw) && typeof raw.code === "string" ? raw.code : res.status === 404 ? "not_found" : "http_error";
        const retryAfterMs = isRecord(raw) && typeof raw.retryAfterMs === "number" ? raw.retryAfterMs : undefined;
        return { ok: false, status: res.status, code, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
      }
      const value = parse(raw);
      if (value === null) return { ok: false, status: res.status, code: "bad_response" };
      const etag = res.headers.get("ETag") ?? undefined;
      return { ok: true, value, ...(etag ? { etag } : {}), ...(res.headers.get("X-Dash-Index") === "building" ? { building: true } : {}) };
    } catch (error) {
      if (isAbort(error) || opts.signal?.aborted) return { ok: false, status: 0, code: "aborted", aborted: true };
      return { ok: false, status: 0, code: "network" };
    }
  }

  return {
    list(settings: ApiSettings, params: ChatListParams, opts: { signal?: AbortSignal; etag?: string } = {}): Promise<ApiResult<ChatPage>> {
      return get(settings, `/chats${query({ limit: params.limit ?? 50, cursor: params.cursor, kind: csv(params.kinds), host: csv(params.hosts), chatable: params.chatable ? 1 : undefined })}`, parseChatPage, opts);
    },
    search(settings: ApiSettings, params: ChatSearchParams, opts: { signal?: AbortSignal } = {}): Promise<ApiResult<ChatSearchPage>> {
      return get(settings, `/chats/search${query({ q: params.q, limit: params.limit ?? 20, cursor: params.cursor, kind: csv(params.kinds), host: csv(params.hosts), in: params.in })}`, parseChatSearchPage, opts);
    },
    history(settings: ApiSettings, params: HistoryParams, opts: { signal?: AbortSignal } = {}): Promise<ApiResult<HistoryPage>> {
      return get(settings, `/chats/history${query({ key: params.key, before: params.before, limit: params.limit ?? 50 })}`, parseHistoryPage, opts);
    },
    message(settings: ApiSettings, params: { key: string; id: string }, opts: { signal?: AbortSignal } = {}): Promise<ApiResult<HistoryMessage>> {
      return get(settings, `/chats/message${query({ key: params.key, id: params.id })}`, raw => {
        if (!isRecord(raw) || !isRecord(raw.message)) return null;
        const page = parseHistoryPage({ messages: [raw.message], before: null });
        return page?.messages[0] ?? null;
      }, opts);
    },
  };
}

export type ChatsApi = ReturnType<typeof createChatsApi>;

export const chatsApi: ChatsApi = createChatsApi({
  fetch: (url, init) => fetch(url, init),
  token: settings => executionToken(settings),
});
