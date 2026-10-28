import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseNoticeInput, parseServerMessage, type NoticeInput, type NoticeMessage } from "../../shared/protocol";
import { bearerToken, secretMatches } from "./bridge-security";
import { DAY, DEFAULT_POSTURE_CONFIG, fmt } from "../../shared/human-posture";
import { route, type Decision } from "../../shared/interaction-policy";
import { NOTICE_BODY_MAX } from "../../shared/protocol";
import { defaultPostureFile, defaultPostureConfigFile, readAnchors, readPosture } from "./posture-http";

interface HeldNotice { id: string; input: NoticeInput; releaseAt: string | null }
interface DeferredState { items: HeldNotice[]; dropped: number }
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function atomic(path: string, value: unknown) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  chmodSync(temp, 0o600); renameSync(temp, path);
}
export function releaseBatch(items: readonly HeldNotice[], now: number, posture: Decision, tz: string): HeldNotice[] {
  if (!DAY.has(posture.phase)) return [];
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 8) return [];
  return items.filter(item => (!item.input.not_before || Date.parse(item.input.not_before) <= now) && (!item.releaseAt || Date.parse(item.releaseAt) <= now));
}

/** Private, atomic, bounded history. Stable ids make replay safe for old/new sockets. */
export class NoticeService {
  private items: NoticeMessage[] = [];
  private readonly listeners = new Set<(notice: NoticeMessage) => void>();
  private readonly path: string;
  /** Set when a corrupt history file was moved aside at startup. */
  readonly quarantined: string | undefined;
  private readonly deferredPath: string;
  private held: DeferredState = { items: [], dropped: 0 };
  /** onPublish: called after each new notice is stored and broadcast, with the count of live sockets that took it. */
  constructor(directory: string, private readonly onPublish?: (notice: NoticeMessage, delivered: number) => void) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "notices.json");
    this.deferredPath = join(directory, "notices-deferred.json");
    try {
      const raw: unknown = JSON.parse(readFileSync(this.deferredPath, "utf8"));
      if (!record(raw) || !Array.isArray(raw.items) || !Number.isInteger(raw.dropped) || typeof raw.dropped !== "number" || raw.dropped < 0) throw new Error("Invalid deferred notices");
      const items: HeldNotice[] = [];
      for (const item of raw.items) {
        if (!record(item) || typeof item.id !== "string" || !(item.releaseAt === null || typeof item.releaseAt === "string" && Number.isFinite(Date.parse(item.releaseAt)))) throw new Error("Invalid deferred notice");
        const input = parseNoticeInput(item.input);
        if (!input) throw new Error("Invalid deferred input");
        items.push({ id: item.id, input, releaseAt: item.releaseAt });
      }
      this.held = { items: items.slice(-200), dropped: raw.dropped + Math.max(0, items.length - 200) };
      chmodSync(this.deferredPath, 0o600);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        // A bad deferred queue must never stop the bridge: move it aside (still private) and start empty.
        this.held = { items: [], dropped: 0 };
        const aside = `${this.deferredPath}.corrupt-${Date.now()}`;
        try { renameSync(this.deferredPath, aside); chmodSync(aside, 0o600); } catch { /* an unmovable file is rewritten on the next hold */ }
      }
    }
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
  deferred(): Readonly<DeferredState> { return this.held; }
  hold(input: NoticeInput, releaseAt: string | null): void {
    const items = [...this.held.items, { id: crypto.randomUUID(), input, releaseAt }];
    const next = { items: items.slice(-200), dropped: this.held.dropped + Math.max(0, items.length - 200) };
    atomic(this.deferredPath, next); this.held = next;
  }
  release(now: number, posture: Decision, tz: string): NoticeMessage | null {
    const ready = releaseBatch(this.held.items, now, posture, tz);
    if (!ready.length) return null;
    // Stable batch identity prevents a second publish after a crash between the two renames.
    const id = `held:${new Bun.CryptoHasher("sha256").update(ready.map(item => item.id).join(":")).digest("hex")}`;
    const existing = this.items.find(item => item.id === id);
    const notice = existing ?? this.publish({ title: `Held overnight: ${ready.length} updates`,
      body: ready.map(item => item.input.title).join("\n").slice(0, NOTICE_BODY_MAX), class: "digest", url: "dash://notices" }, id);
    const ids = new Set(ready.map(item => item.id));
    const next = { ...this.held, items: this.held.items.filter(item => !ids.has(item.id)) };
    atomic(this.deferredPath, next); this.held = next;
    return notice;
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
  publish(input: NoticeInput, id: string = crypto.randomUUID()): NoticeMessage {
    const notice: NoticeMessage = { ...input, type: "notice", id };
    this.write([...this.items, notice].slice(-50));
    let delivered = 0;
    for (const send of this.listeners) {
      try { send(notice); delivered++; } catch { this.listeners.delete(send); }
    }
    try { this.onPublish?.(notice, delivered); } catch { /* logging must never fail a publish */ }
    return notice;
  }
}

interface NoticePolicyOptions {
  token: string; notices: NoticeService; now?: () => number; file?: string; configFile?: string;
  log?: (entry: unknown) => void;
}
export function createNoticeHttpHandler(options: NoticePolicyOptions) {
  let windowStart = 0, count = 0;
  let hourKey = "", blockKey = "", hourly = 0, block = 0;
  let pending: Promise<unknown> = Promise.resolve();
  const submit = (input: NoticeInput, now: number): Promise<Response> => {
    const work = pending.then(async () => {
      const anchors = await readAnchors(options.configFile ?? defaultPostureConfigFile());
      const posture = await readPosture(options.file ?? defaultPostureFile(), now, anchors);
      const key = fmt(now).slice(0, 13), boundary = `${posture.decision.peakStartAt}:${posture.decision.phase}`;
      if (key !== hourKey) { hourKey = key; hourly = 0; }
      if (boundary !== blockKey) { blockKey = boundary; block = 0; }
      // The host snapshot may include other producers. Local deliveries consume its remaining budget too.
      const decision = { ...posture.decision, capRemaining: Math.max(0, posture.decision.capRemaining -
        Math.max(hourly, posture.decision.interruptCapPerBlock > 0 ? block : 0)) };
      const routed = route(decision, { cls: input.class, producer: "dash-notify" }, fmt(now));
      const scheduled = input.not_before && Date.parse(input.not_before) > now ? input.not_before : null;
      const enforcing = posture.source === "circadiand" && posture.enforcingNow;
      const releaseAt = scheduled && (!routed.releaseAt || Date.parse(scheduled) > Date.parse(routed.releaseAt)) ? scheduled : routed.releaseAt;
      const effective = input.class === "critical" ? { ...input, class: routed.cls } : input;
      if (scheduled || enforcing && routed.action !== "deliver") {
        options.notices.hold(effective, scheduled && !enforcing ? scheduled : releaseAt);
        return Response.json({ held: true, releaseAt: scheduled && !enforcing ? scheduled : releaseAt }, { status: 202 });
      }
      (options.log ?? (entry => console.info(JSON.stringify(entry))))({ event: "notice-policy", source: posture.source, enforcing, action: routed.action, cls: routed.cls });
      const notice = options.notices.publish(effective); hourly++; block++;
      return Response.json(notice, { status: 201 });
    });
    pending = work.catch(() => {});
    return work;
  };
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
    try { return await submit(input, now); }
    catch { return new Response("notice storage unavailable", { status: 503 }); }
  };
}

/** Separate from the tailnet bridge: no reports ingress on a public/tailnet interface. */
export function startNoticeServer(options: NoticePolicyOptions & { port: number }) {
  const handle = createNoticeHttpHandler(options);
  let releasing = false;
  const timer = setInterval(() => {
    if (releasing) return;
    releasing = true;
    void (async () => {
      const now = (options.now ?? Date.now)();
      const anchors = await readAnchors(options.configFile ?? defaultPostureConfigFile());
      const { decision } = await readPosture(options.file ?? defaultPostureFile(), now, anchors);
      options.notices.release(now, decision, anchors.tz ?? DEFAULT_POSTURE_CONFIG.tz);
    })().catch(() => console.error("notice digest storage unavailable")).finally(() => { releasing = false; });
  }, 60_000);
  timer.unref();
  const server = Bun.serve({ hostname: "127.0.0.1", port: options.port, maxRequestBodySize: 8192,
    fetch: (request, server) => handle(request, server.requestIP(request)?.address ?? null) });
  const stop = server.stop.bind(server);
  server.stop = (...args) => { clearInterval(timer); return stop(...args); };
  return server;
}

/** Notices are optional: a taken port or bind error must not take the chat bridge down. */
export function tryStartNoticeServer(options: NoticePolicyOptions & { port: number }, onError: (message: string) => void): ReturnType<typeof startNoticeServer> | null {
  try { return startNoticeServer(options); }
  catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "bind failed";
    onError(`notice listener unavailable on 127.0.0.1:${options.port} (${code})`);
    return null;
  }
}
