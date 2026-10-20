import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveServerMessage } from "../../shared/live";
import { hermesProfileOf, LiveSurface } from "./live-surface";

// A fake z0bridge with the fx worker routes Dash uses.
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "dash-live-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, "z".repeat(64));
const calls: string[] = [];
let server: ReturnType<typeof Bun.serve>;
const sse = (events: object[]) => new Response(events.map((e, i) => `id: ${i + 1}\ndata: ${JSON.stringify({ seq: i + 1, ...e })}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.headers.get("authorization") !== `Bearer ${"z".repeat(64)}`) return new Response("{}", { status: 401 });
      const p = url.pathname;
      if (p === "/v1/sessions" && request.method === "POST") {
        const body = await request.json() as { harness: string };
        return Response.json(body.harness === "hermes" ? { id: "local-new", title: "Dash live surface" } : { id: "wrun_1", parent: { id: "local-new" } }, { status: 201 });
      }
      if (p === "/v1/sessions" && request.method === "GET") return Response.json({ sessions: [] });
      if (p === "/v1/harnesses") return Response.json({ harnesses: [{ id: "fx", version: "codex:gpt-5.6-sol" }] });
      if (p.endsWith("/artifacts")) return Response.json({ artifacts: [] });
      if (p.endsWith("/artifacts/1")) return new Response("<!doctype html><meta http-equiv=\"Content-Security-Policy\"><html></html>");
      if (p.endsWith("/turns")) return Response.json({ turnId: "t1" }, { status: 202 });
      if (p === "/v1/turns/t1/events") return sse([
        { type: "delta", text: "Here" },
        { type: "artifact", artifact: { kind: "html", version: 1, bytes: 60, sha256: "aa", createdAt: 1, title: "Header" } },
        { type: "hermes", phase: "answered", text: "app/src/components/WorkspaceHeader.tsx" },
        { type: "receipt", receipt: { worker: "wrun_1", parent: {}, kind: "turn", summary: "x", decisions: [], artifacts: [], at: 1, hermes: { child: "fxw_wrun_1", messageId: 3 } } },
        { type: "done", stopReason: "end_turn" },
      ]);
      if (p.endsWith("/intents")) return Response.json({ receipt: { kind: "intent", summary: "picked", decisions: ["header = Split"], artifacts: [], at: 2 } }, { status: 201 });
      return new Response("{}", { status: 404 });
    },
  });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

function surface() { return new LiveSurface({ baseUrl: `http://127.0.0.1:${server.port}`, tokenFile, defaultProfile: "clean" }); }

test("opening a chat with no Hermes session creates it through z0bridge, then attaches a worker to it", async () => {
  const sent: LiveServerMessage[] = [];
  await surface().handle({ type: "live_open", id: "r1" }, m => sent.push(m));
  expect(sent).toEqual([{ type: "live_opened", id: "r1", workerId: "wrun_1", profileId: "clean", parentSessionId: "local-new", parentTitle: "Dash live surface", model: "codex:gpt-5.6-sol", artifacts: [] }]);
  expect(calls.filter(c => c.startsWith("POST /v1/sessions"))).toHaveLength(2);
});

test("a live turn forwards the worker stream with fx0 html fetched in prepared form", async () => {
  const sent: LiveServerMessage[] = [];
  await surface().handle({ type: "live_turn", id: "r2", workerId: "wrun_1", profileId: "clean", text: "where is the header", askHermes: true }, m => sent.push(m));
  expect(sent.map(m => m.type === "live_event" ? m.event.type : m.type)).toEqual(["delta", "artifact", "hermes", "receipt", "done"]);
  const artifact = sent[1];
  expect(artifact?.type === "live_event" && artifact.event.type === "artifact" && artifact.event.artifact.html).toContain("Content-Security-Policy");
  expect(calls).toContain("GET /v1/sessions/fx/clean/wrun_1/artifacts/1?prepared=1");
});

test("a tap is recorded as an intent receipt; z0bridge down is a plain error, never a fake reply", async () => {
  const sent: LiveServerMessage[] = [];
  await surface().handle({ type: "live_intent", id: "r3", workerId: "wrun_1", profileId: "clean", intent: { controlId: "header", value: "split", label: "Split" } }, m => sent.push(m));
  expect(sent[0]).toMatchObject({ type: "live_event", event: { type: "receipt", receipt: { decisions: ["header = Split"] } } });
  const down: LiveServerMessage[] = [];
  await new LiveSurface({ baseUrl: "http://127.0.0.1:9", tokenFile }).handle({ type: "live_open", id: "r4" }, m => down.push(m));
  expect(down).toEqual([{ type: "live_error", id: "r4", message: "Live surface needs z0bridge running with --fx on this host." }]);
});

test("Dash profile ids map to Hermes profile names", () => {
  expect(hermesProfileOf("hermes:session:clean:local-1", "default")).toBe("clean");
  expect(hermesProfileOf("hermes:default", "x")).toBe("default");
  expect(hermesProfileOf(undefined, "clean")).toBe("clean");
  expect(hermesProfileOf("../etc", "clean")).toBe("clean");
});
