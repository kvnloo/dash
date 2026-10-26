import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseNoticeInput, parseServerMessage, type NoticeInput, type NoticeMessage } from "../../shared/protocol";
import { bearerToken, secretMatches } from "./bridge-security";

/** Private, atomic, bounded history. Stable ids make replay safe for old/new sockets. */
export class NoticeService {
  private items: NoticeMessage[] = [];
  private readonly listeners = new Set<(notice: NoticeMessage) => void>();
  private readonly path: string;
  /** Set when a corrupt history file was moved aside at startup. */
  readonly quarantined: string | undefined;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "notices.json");
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (!Array.isArray(raw)) throw new Error("Invalid notice history");
      const ids = new Set<string>();
      for (const item of raw.slice(-50)) {
        const parsed = parseServerMessage(item);
        if (parsed?.type !== "notice") throw new Error("Invalid notice history entry");
        if (!ids.has(parsed.id)) { ids.add(parsed.id); this.items.push(parsed); }
      }
      chmodSync(this.path, 0o600);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") { this.quarantined = undefined; return; }
      // A bad history must never stop the bridge: move it aside (still private) and start empty.
      this.items = [];
      const aside = `${this.path}.corrupt-${Date.now()}`;
      try { renameSync(this.path, aside); chmodSync(aside, 0o600); this.quarantined = aside; }
      catch { this.quarantined = undefined; }
      return;
    }
    this.quarantined = undefined;
  }
  list(): readonly NoticeMessage[] { return this.items; }
  subscribe(send: (notice: NoticeMessage) => void): () => void {
    this.listeners.add(send);
    try { for (const notice of this.items) send(notice); }
    catch (error) { this.listeners.delete(send); throw error; }
    return () => { this.listeners.delete(send); };
  }
  private write(next: NoticeMessage[]): void {
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
    this.items = next;
  }
  /** Phone "forget everything": drop the replay ring so a re-paired phone starts clean. */
  clear(): void { this.write([]); }
  publish(input: NoticeInput): NoticeMessage {
    const notice: NoticeMessage = { ...input, type: "notice", id: crypto.randomUUID() };
    this.write([...this.items, notice].slice(-50));
    for (const send of this.listeners) {
      try { send(notice); } catch { this.listeners.delete(send); }
    }
    return notice;
  }
}

export function createNoticeHttpHandler(options: { token: string; notices: NoticeService; now?: () => number }) {
  let windowStart = 0, count = 0;
  return async (request: Request, peer: string | null): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== "/notice") return new Response("not found", { status: 404 });
    // Ignore proxy headers. Browsers cannot use the local reporting surface.
    if ((peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") || request.headers.has("origin") ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || request.headers.get("host") && request.headers.get("host") !== url.host) return new Response("forbidden", { status: 403 });
    if (!options.token.trim() || !secretMatches(bearerToken(request), options.token)) return new Response("unauthorized", { status: 401 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return new Response("JSON required", { status: 415 });
    const now = (options.now ?? Date.now)();
    if (now - windowStart >= 60000) { windowStart = now; count = 0; }
    if (count >= 10) return new Response("rate limited", { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((60000 - (now - windowStart)) / 1000))) } });
    // Charge failed submissions too. Body is streamed so a forged Content-Length is harmless.
    count++;
    const reader = request.body?.getReader();
    if (!reader) return new Response("body required", { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return new Response("body too large", { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return new Response("invalid JSON", { status: 400 }); }
    const input = parseNoticeInput(raw);
    if (!input) return new Response("invalid notice (title 1–80, body 1–600, optional dash:// URL)", { status: 400 });
    try { return Response.json(options.notices.publish(input), { status: 201 }); }
    catch { return new Response("notice storage unavailable", { status: 503 }); }
  };
}

/** Separate from the tailnet bridge: no reports ingress on a public/tailnet interface. */
export function startNoticeServer(options: { token: string; notices: NoticeService; port: number }) {
  const handle = createNoticeHttpHandler(options);
  return Bun.serve({ hostname: "127.0.0.1", port: options.port, maxRequestBodySize: 8192,
    fetch: (request, server) => handle(request, server.requestIP(request)?.address ?? null) });
}

/** Notices are optional: a taken port or bind error must not take the chat bridge down. */
export function tryStartNoticeServer(options: { token: string; notices: NoticeService; port: number }, onError: (message: string) => void): ReturnType<typeof startNoticeServer> | null {
  try { return startNoticeServer(options); }
  catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "bind failed";
    onError(`notice listener unavailable on 127.0.0.1:${options.port} (${code})`);
    return null;
  }
}
