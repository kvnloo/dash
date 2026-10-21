import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AcpStatus } from "../../shared/protocol";
import type { Sink } from "./harnesses";
import { Z0BridgeHermes } from "./z0bridge-hermes";

const scratchRoot = process.env.TMPDIR ?? join(homedir(), ".cache", "dash-tests");
mkdirSync(scratchRoot, { recursive: true });
const dir = mkdtempSync(join(scratchRoot, "dash-z0bridge-"));
const tokenFile = join(dir, "token");
const TOKEN = "z".repeat(64);
type Seen = { method: string; path: string; body?: unknown };
const seen: Seen[] = [];
let mode: "ok" | "refuse" | "slow" = "ok";
let cancelled = false;

const session = (profile: string, id: string, at: number) => ({ harness: "hermes", profile, id, title: `T ${id}`, source: "local", cwd: "/p", startedAt: at, lastActivityAt: at, messageCount: 2, ended: false });
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json() : undefined;
    seen.push({ method: request.method, path: url.pathname + url.search, body });
    if (url.pathname === "/v1/health") return Response.json({ ok: true, name: "z0bridge", version: "0.1.0", api: "v1" });
    if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: { code: "unauthorized", message: "no" } }, { status: 401 });
    if (url.pathname === "/v1/sessions") {
      const many = Array.from({ length: 60 }, (_, i) => session("clean", `c${i}`, 10_000 - i));
      return Response.json({ sessions: [session("default", "d1", 20_000), ...many] });
    }
    if (url.pathname === "/v1/sessions/hermes/clean/c1/messages") return Response.json({ messages: [{ id: "7", role: "user", text: "hi", at: 1 }, { id: "8", role: "assistant", text: "yo", at: 2 }], latestId: "8" });
    if (url.pathname.endsWith("/messages")) return Response.json({ error: { code: "not_found", message: "Session not found" } }, { status: 404 });
    if (url.pathname.endsWith("/turns")) {
      if (mode === "refuse") return Response.json({ error: { code: "live_elsewhere", message: "Open in another Hermes surface" } }, { status: 409 });
      return Response.json({ turnId: "turn_1", sessionId: "c1", eventsUrl: "/v1/turns/turn_1/events" }, { status: 202 });
    }
    if (url.pathname === "/v1/turns/turn_1/cancel") { cancelled = true; return Response.json({ id: "turn_1", state: "running" }, { status: 202 }); }
    if (url.pathname === "/v1/turns/turn_1/events") {
      const enc = new TextEncoder();
      const frames = mode === "slow"
        ? [{ seq: 1, type: "status", text: "running" }, { seq: 2, type: "delta", text: "wor" }]
        : [{ seq: 1, type: "status", text: "running" }, { seq: 2, type: "tool", toolCallId: "t1", title: "read_file", status: "completed" }, { seq: 3, type: "delta", text: "po" }, { seq: 4, type: "delta", text: "ng" }, { seq: 5, type: "done", stopReason: "end_turn" }];
      return new Response(new ReadableStream({
        async start(controller) {
          for (const frame of frames) controller.enqueue(enc.encode(`id: ${frame.seq}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`));
          if (mode === "slow") {
            for (let i = 0; i < 100 && !cancelled; i++) await Bun.sleep(10);
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ seq: 3, type: "done", stopReason: "cancelled" })}\n\n`));
          }
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ error: { code: "not_found", message: "?" } }, { status: 404 });
  },
});

function bridge(extra: Record<string, string> = {}): Z0BridgeHermes {
  return new Z0BridgeHermes({ env: { DASH_Z0BRIDGE_URL: `http://127.0.0.1:${server.port}`, DASH_Z0BRIDGE_TOKEN_FILE: tokenFile, ...extra } });
}
function sink() {
  const out = { sessions: [] as string[], text: "", statuses: [] as Array<[string, AcpStatus | undefined]>, errors: [] as string[] };
  const value: Sink = { session: id => out.sessions.push(id), delta: t => { out.text += t; }, status: (t, acp) => out.statuses.push([t, acp]), error: m => out.errors.push(m) };
  return { out, value };
}

beforeAll(() => { writeFileSync(tokenFile, TOKEN); chmodSync(tokenFile, 0o600); });
afterEach(() => { seen.length = 0; mode = "ok"; cancelled = false; chmodSync(tokenFile, 0o600); });
afterAll(async () => { await server.stop(true); rmSync(dir, { recursive: true, force: true }); });

test("falls back (undefined) when z0bridge is not configured, disabled, non-loopback or not running", async () => {
  expect(await new Z0BridgeHermes({ env: { DASH_Z0BRIDGE_TOKEN_FILE: join(dir, "missing") } }).list()).toBeUndefined();
  expect(await bridge({ DASH_Z0BRIDGE: "0" }).list()).toBeUndefined();
  expect(await bridge({ DASH_Z0BRIDGE_URL: "http://10.0.0.5:4787" }).ready()).toBeUndefined();
  expect(await bridge({ DASH_Z0BRIDGE_URL: "http://127.0.0.1:1" }).history("clean", "c1")).toBeUndefined();
  chmodSync(tokenFile, 0o644);
  expect(await bridge().ready()).toBeUndefined();
});

test("lists Hermes sessions as Dash agents, capped at 50 per profile", async () => {
  const agents = await bridge().list();
  expect(agents?.length).toBe(51);
  expect(agents?.[0]).toMatchObject({ id: "hermes:session:default:d1", kind: "hermes", status: "available", sessionId: "d1", profileId: "default", name: "T d1", detail: "default · local", cwd: "/p", messageCount: 2 });
  expect(agents?.filter(a => a.profileId === "clean").length).toBe(50);
  expect(seen.some(s => s.path.startsWith("/v1/sessions?harness=hermes"))).toBe(true);
});

test("history maps messages; an unknown session is empty, not a fallback", async () => {
  expect(await bridge().history("clean", "c1")).toEqual([{ id: "7", role: "user", text: "hi", at: 1 }, { id: "8", role: "assistant", text: "yo", at: 2 }]);
  expect(await bridge().history("clean", "gone")).toEqual([]);
});

test("continue streams deltas and tool status, queues behind live owners by default", async () => {
  const z0 = bridge();
  const client = await z0.ready();
  const { out, value } = sink();
  const outcome = await z0.continue(client!, { profile: "clean", sessionId: "c1", text: "hello" }, value, new AbortController().signal);
  expect(outcome).toEqual({ exitCode: 0 });
  expect(out.text).toBe("pong");
  expect(out.sessions).toEqual(["c1"]);
  expect(out.statuses.find(([t]) => t === "read_file")?.[1]).toMatchObject({ sessionId: "c1", update: { toolCallId: "t1", status: "completed" } });
  expect(seen.find(s => s.path.endsWith("/turns"))?.body).toEqual({ text: "hello", onLive: "queue" });
});

test("a refusal is final: reported once, never retried", async () => {
  mode = "refuse";
  const z0 = bridge({ DASH_Z0BRIDGE_ON_LIVE: "refuse" });
  const { out, value } = sink();
  const outcome = await z0.continue((await z0.ready())!, { profile: "clean", sessionId: "c1", text: "hello" }, value, new AbortController().signal);
  expect(outcome).toMatchObject({ exitCode: 1, message: expect.stringContaining("live_elsewhere") });
  expect(seen.filter(s => s.path.endsWith("/turns")).length).toBe(1);
  expect(seen.find(s => s.path.endsWith("/turns"))?.body).toMatchObject({ onLive: "refuse" });
  expect(out.text).toBe("");
});

test("abort cancels the z0bridge turn", async () => {
  mode = "slow";
  const z0 = bridge();
  const abort = new AbortController();
  const { out, value } = sink();
  const running = z0.continue((await z0.ready())!, { profile: "clean", sessionId: "c1", text: "slow" }, value, abort.signal);
  for (let i = 0; i < 100 && !out.text; i++) await Bun.sleep(10);
  abort.abort();
  expect(await running).toEqual({ exitCode: "cancelled" });
  expect(cancelled).toBe(true);
});
