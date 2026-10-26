import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseChatPage, parseChatSearchPage } from "../../shared/protocol";

// Executable route contract for the composed app at integrate/native-acceptance 31a3d4f.
// Every HTTP call site the app makes (file:line at 31a3d4f) is replayed against the REAL compiled
// bridge process (index.ts) in a hermetic temp environment: auth comes before any read (401 without
// a credential, never 404/200), and each route exists with its defined unsupported/missing-data answer.
// Excluded mutations are asserted ABSENT or explicitly unavailable.
interface Call { site: string; method: "GET" | "POST"; path: string; body?: Uint8Array; authed: number[]; check?(body: unknown): void }
const wav = () => { // 0.01 s of silence, PCM16 mono 16 kHz: fixture audio only, never a microphone.
  const samples = 160, data = new Uint8Array(44 + samples * 2), v = new DataView(data.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); s(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, samples * 2, true);
  return data;
};
const CALLS: Call[] = [
  { site: "app/src/lib/roster.ts:68 fetchRoster", method: "GET", path: "/roster", authed: [200], check: b => expect(Array.isArray((b as { hosts?: unknown }).hosts)).toBe(true) }, // app parses raw.hosts
  { site: "app/src/lib/session-phase.ts:32", method: "GET", path: "/hermes/phase?profile=default&session=missing", authed: [200, 404] },
  { site: "app/src/lib/session-activity.ts:21", method: "GET", path: "/hermes/activity?profile=default&session=missing", authed: [200, 404] },
  { site: "app/src/components/WorkersStrip.tsx:42", method: "GET", path: "/hermes/workers?profile=default&session=missing", authed: [200, 404] },
  { site: "app/src/components/ContextCard.tsx:37 (GET)", method: "GET", path: "/chat/context?profile=default&session=missing&harness=hermes", authed: [404], check: b => expect(b).toEqual({ error: "session not found" }) },
  { site: "app/src/components/ContextCard.tsx:37 (non-Hermes harness)", method: "GET", path: "/chat/context?profile=default&session=s1&harness=codex", authed: [200], check: b => expect(b).toMatchObject({ plans: expect.any(Array) }) },
  { site: "app/src/components/ContextCard.tsx:62 (POST compact, EXCLUDED mutation)", method: "POST", path: "/chat/context/compact?profile=default&session=missing", authed: [501], check: b => expect(b).toMatchObject({ ok: false, code: "unavailable" }) },
  { site: "app/src/lib/z0live-state.ts:26", method: "GET", path: "/z0live/state", authed: [200], check: b => expect(b).toMatchObject({ live: false }) },
  { site: "app/src/lib/useOrchestraEvidence.ts:18", method: "GET", path: "/orchestra/graph", authed: [200] },
  { site: "app/src/lib/annotate/io-core.ts:18 (fixture audio; STT model absent)", method: "POST", path: "/transcribe", body: wav(), authed: [503], check: b => expect(b).toEqual({ error: "Speech-to-text is not available on this host." }) },
  { site: "app/src/components/ToolInspector.tsx:22", method: "GET", path: "/files?format=text&path=/nonexistent/dash-contract", authed: [404] },
  { site: "app/src/components/genui/InlineImage.tsx:27", method: "GET", path: "/files?path=/nonexistent/dash-contract.png", authed: [404] },
  // chats.v1 (WP1): header-only auth, paged JSON shapes the app parses with shared/protocol.
  { site: "chats.v1 GET /chats", method: "GET", path: "/chats?limit=5", authed: [200], check: b => expect(parseChatPage(b)).not.toBeNull() },
  { site: "chats.v1 GET /chats/search", method: "GET", path: "/chats/search?q=hello", authed: [200], check: b => expect(parseChatSearchPage(b)).not.toBeNull() },
  { site: "chats.v1 GET /chats/history (unknown chat)", method: "GET", path: "/chats/history?kind=codex&sessionId=missing", authed: [404], check: b => expect(b).toEqual({ ok: false, code: "not_found" }) },
  { site: "chats.v1 GET /chats/message (unknown chat)", method: "GET", path: "/chats/message?key=x:codex:missing&id=av:1", authed: [404] },
];

let dir = "", port = 0, token = "", proc: ReturnType<typeof Bun.spawn> | undefined;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dash-route-contract-"));
  mkdirSync(join(dir, "hermes"), { recursive: true }); mkdirSync(join(dir, "z0live"), { recursive: true });
  proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../index.ts")], {
    env: { ...process.env, DASH_HOST: "127.0.0.1", DASH_ALLOW_LOOPBACK: "1", DASH_PORT: "0", DASH_CREDENTIAL_DIR: join(dir, "credentials"),
      DASH_HERMES_ROOT: join(dir, "hermes"), DASH_Z0LIVE_SESSIONS: join(dir, "z0live"), DASH_STT_MODEL: join(dir, "no-model"), DASH_SHARE_DIRS: dir,
      DASH_CHAT_INDEX: join(dir, "chat-index.db"), DASH_AGENTSVIEW_DB: join(dir, "no-agentsview.db") },
    stdout: "ignore", stderr: "pipe",
  });
  void (async () => { for await (const chunk of proc!.stderr as ReadableStream<Uint8Array>) { const m = /dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.exec(new TextDecoder().decode(chunk)); if (m) port = Number(m[1]); } })();
  for (let n = 0; !port && n < 300; n++) await Bun.sleep(20);
  token = readFileSync(join(dir, "credentials/token"), "utf8").trim();
});
afterAll(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("composed-app route contract against the compiled bridge", () => {
  for (const call of CALLS) test(`${call.method} ${call.path.split("?")[0]} — ${call.site}`, async () => {
    expect(port).toBeGreaterThan(0);
    const url = `http://127.0.0.1:${port}${call.path}`;
    const base: Record<string, string> = call.body ? { "content-type": "audio/wav" } : {};
    const init = { method: call.method, ...(call.body ? { body: call.body } : {}) };
    // Fail closed before any read: no credential, and a wrong one.
    expect((await fetch(url, { ...init, headers: base })).status).toBe(401);
    expect((await fetch(url, { ...init, headers: { ...base, Authorization: "Bearer wrong" } })).status).toBe(401);
    const res = await fetch(url, { ...init, headers: { ...base, Authorization: `Bearer ${token}` } });
    expect(call.authed).toContain(res.status);
    const text = await res.text();
    if (call.check) call.check(JSON.parse(text));
  });

  test("legacy query-token roster client (app/src/lib/roster.ts:61) still works", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/roster?token=${encodeURIComponent(token)}`)).status).toBe(200);
  });

  test("paired WebSocket: anonymous rejected, paired history request answered (send/history path)", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/ws?token=invalid`)).status).toBe(401);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const messages: { type?: string }[] = [];
    ws.onmessage = e => messages.push(JSON.parse(String(e.data)));
    await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error("socket error")); });
    ws.send(JSON.stringify({ type: "history", id: "contract-history", harness: "hermes", sessionId: "missing-session" }));
    for (let n = 0; n < 150 && !messages.some(m => m.type === "history" || m.type === "error"); n++) await Bun.sleep(20);
    ws.close();
    expect(messages.some(m => m.type === "history" || m.type === "error")).toBe(true);
  });

  test("excluded on this line: native duplex voice bootstrap is not carried (grant-gated, separate rollout)", async () => {
    // The route exists but grants nothing to a legacy pairing token: identity-only, so 401.
    const res = await fetch(`http://127.0.0.1:${port}/voice/bootstrap`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  test("chats.v1: /chats* ignore ?token= (header-only); hello advertises the feature", async () => {
    for (const path of ["/chats", "/chats/search?q=x", "/chats/history?kind=codex&sessionId=s"]) {
      const sep = path.includes("?") ? "&" : "?";
      expect((await fetch(`http://127.0.0.1:${port}${path}${sep}token=${encodeURIComponent(token)}`)).status).toBe(401);
    }
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const messages: { type?: string; features?: unknown; requestId?: string; before?: unknown; messages?: unknown[] }[] = [];
    ws.onmessage = e => messages.push(JSON.parse(String(e.data)));
    await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error("socket error")); });
    for (let n = 0; n < 150 && !messages.some(m => m.type === "hello"); n++) await Bun.sleep(20);
    expect(messages.find(m => m.type === "hello")?.features).toEqual(["chats.v1"]);
    ws.send(JSON.stringify({ type: "history", harness: "codex", sessionId: "missing", limit: 50, requestId: "r-1" }));
    ws.send(JSON.stringify({ type: "history", harness: "codex", sessionId: "missing-old" }));
    for (let n = 0; n < 150 && messages.filter(m => m.type === "history").length < 2; n++) await Bun.sleep(20);
    ws.close();
    const [paged, legacy] = messages.filter(m => m.type === "history");
    expect(paged).toMatchObject({ requestId: "r-1", before: null, messages: [] });
    expect(legacy && "requestId" in legacy).toBe(false);
    expect(legacy && "before" in legacy).toBe(false);
  });
});
