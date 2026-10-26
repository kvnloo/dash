import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MESSAGE_TEXT_MAX, parseHistoryPage, type HistoryMessage } from "../../../shared/protocol";
import { AgentsviewFixture, engineConfig, HermesFixture, inProcessWorker, TEST_RPC_TIMEOUT_MS, tempDir } from "../fixtures/chat-index/make-fixtures";
import { ChatIndexClient } from "./client";
import { createChatsHttpHandler } from "./http";
import { hermesWsPage } from "./hermes-src";
import { ChatIndexEngine } from "./worker";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });

function setup() {
  const dir = tempDir();
  const av = new AgentsviewFixture(join(dir, "av.db"));
  av.session({ id: "codex:long", agent: "codex", ended_at: "2026-10-01T05:00:00Z" });
  av.db.transaction(() => {
    for (let i = 0; i < 5508; i++) av.message({ session_id: "codex:long", ordinal: i, role: i % 2 ? "assistant" : "user", content: `m${i}`, timestamp: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString() });
    // Non-chat rows inside the range never come back.
    av.message({ session_id: "codex:long", ordinal: 6000, role: "tool", content: "tool row" });
    av.message({ session_id: "codex:long", ordinal: 6001, role: "user", content: "system row", is_system: 1 });
  })();
  av.session({ id: "codex:big", agent: "codex", ended_at: "2026-10-01T04:00:00Z" });
  av.message({ session_id: "codex:big", ordinal: 0, role: "user", content: "x".repeat(20_000) + " token=sk-abcdefghijklmnopqrstuvwxyz123456" });
  av.session({ id: "oc1", agent: "opencode", ended_at: "2026-10-01T03:00:00Z" });
  av.message({ session_id: "oc1", ordinal: 0, role: "user", content: "opencode question" });
  const config = engineConfig(dir, { agentsviewPath: av.path });
  const client = new ChatIndexClient({ config, spawn: inProcessWorker(config), timeoutMs: TEST_RPC_TIMEOUT_MS });
  cleanup.push(() => client.stop());
  const handle = createChatsHttpHandler({ authorize: async () => true, client, self: () => ({ id: "0", name: "groot", matches: h => h === "0" || h === "groot" }), live: () => [] });
  const get = async (p: string) => { const r = await handle(new Request(`http://b${p}`)); if (!r) throw new Error("unrouted"); return r; };
  return { dir, av, client, get, config, ingest: () => client.primary.call({ op: "ingest", args: null }) };
}

describe("GET /chats/history", () => {
  test("ordinal keyset pages cover a 5,508-message session exactly once; before=null at the start", async () => {
    const { get, ingest } = setup();
    await ingest();
    const ids: string[] = [];
    let before: string | null = null;
    let first = true;
    for (let n = 0; n < 100; n++) {
      const res = await get(`/chats/history?key=0:codex:long&limit=200${before ? `&before=${before}` : ""}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(first ? "no-store" : "private, max-age=300");
      first = false;
      const page = parseHistoryPage(await res.json());
      if (!page) throw new Error("bad page");
      ids.unshift(...page.messages.map(m => m.id));
      expect(page.messages.every((m, i) => i === 0 || m.at > (page.messages[i - 1]?.at ?? Infinity))).toBe(true);
      before = page.before;
      if (!before) break;
    }
    expect(ids.length).toBe(5508);
    expect(new Set(ids).size).toBe(5508);
    expect(before).toBeNull();
  }, 30_000);

  test("by kind+sessionId+host as well as key; unknown and foreign hosts are 404", async () => {
    const { get, ingest } = setup();
    await ingest();
    const page = parseHistoryPage(await (await get("/chats/history?kind=codex&sessionId=long&host=groot&limit=2")).json());
    expect(page?.messages.map(m => m.text)).toEqual(["m5506", "m5507"]);
    expect((await get("/chats/history?key=0:codex:nope")).status).toBe(404);
    expect((await get("/chats/history?key=elsewhere:codex:long")).status).toBe(404);
    expect((await get("/chats/history?kind=codex&sessionId=long&host=elsewhere")).status).toBe(404);
    expect((await get("/chats/history?key=0:codex:long&before=bad!")).status).toBe(400);
  });

  test("truncated above 16,000 chars; /chats/message returns the full redacted text", async () => {
    const { get, ingest } = setup();
    await ingest();
    const page = parseHistoryPage(await (await get("/chats/history?key=0:codex:big")).json());
    const message = page?.messages[0];
    expect(message?.truncated).toBe(true);
    expect(message?.text.length).toBe(MESSAGE_TEXT_MAX);
    const full = await (await get(`/chats/message?key=0:codex:big&id=${message?.id}`)).json() as { message: HistoryMessage };
    expect(full.message.text.length).toBeGreaterThan(20_000);
    expect(full.message.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect((await get(`/chats/message?key=0:codex:long&id=${message?.id}`)).status).toBe(404);
    expect((await get("/chats/message?key=0:codex:big&id=drop%20table")).status).toBe(400);
  });

  test("chats Dash ran (sdk-cli, non-interactive) are unlisted but their ws cursor continues over HTTP", async () => {
    const { av, client, get, ingest } = setup();
    av.session({ id: "claude:sdk1", agent: "claude", entrypoint: "sdk-cli", ended_at: "2026-10-01T06:00:00Z" });
    av.session({ id: "codex:exec1", agent: "codex", session_kind: "non-interactive", ended_at: "2026-10-01T06:00:00Z" });
    av.session({ id: "claude:del1", agent: "claude", entrypoint: "sdk-cli", deleted_at: "2026-10-02T00:00:00Z", ended_at: "2026-10-01T06:00:00Z" });
    av.db.transaction(() => {
      for (const id of ["claude:sdk1", "codex:exec1", "claude:del1"]) {
        for (let i = 0; i < 60; i++) av.message({ session_id: id, ordinal: i, role: i % 2 ? "assistant" : "user", content: `${id}-${i}${i === 1 ? "x".repeat(20_000) : ""}`, timestamp: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString() });
      }
    })();
    await ingest();
    for (const [kind, sessionId] of [["claude", "sdk1"], ["codex", "exec1"]] as const) {
      const ws = await client.wsHistory({ kind, sessionId, limit: 50 });
      expect(ws.messages.length).toBe(50);
      expect(ws.before).not.toBeNull();
      const res = await get(`/chats/history?key=0:${kind}:${sessionId}&limit=50&before=${ws.before}`);
      expect(res.status).toBe(200);
      const older = parseHistoryPage(await res.json());
      expect(older?.messages.map(m => m.text.slice(0, 40))).toEqual(Array.from({ length: 10 }, (_, i) => `${kind}:${sessionId}-${i}${i === 1 ? "x".repeat(40 - `${kind}:${sessionId}-1`.length) : ""}`));
      expect(older?.before).toBeNull();
      const cut = older?.messages[1];
      expect(cut?.truncated).toBe(true);
      expect((await get(`/chats/message?key=0:${kind}:${sessionId}&id=${cut?.id}`)).status).toBe(200);
      expect((await get(`/chats/history?kind=${kind}&sessionId=${sessionId}&host=groot&limit=5`)).status).toBe(200);
    }
    expect((await get("/chats/history?key=0:claude:del1")).status).toBe(404);
  });

  test("non-catalog kinds are readable over HTTP but not over ws", async () => {
    const { get, ingest, client } = setup();
    await ingest();
    const page = parseHistoryPage(await (await get("/chats/history?key=0:opencode:oc1")).json());
    expect(page?.messages.map(m => m.text)).toEqual(["opencode question"]);
    expect((await client.wsHistory({ kind: "opencode", sessionId: "oc1" })).messages).toEqual([]);
  });

  test("ws window: no limit = the old 400 newest, uncut, no cursor; limit = newest N with a cursor", async () => {
    const { client, get, ingest } = setup();
    await ingest();
    const legacy = await client.wsHistory({ kind: "codex", sessionId: "long" });
    expect(legacy.messages.length).toBe(400);
    expect(legacy.messages[399]?.text).toBe("m5507");
    expect(legacy.messages.every(m => !("ordinal" in m))).toBe(true);
    const big = await client.wsHistory({ kind: "codex", sessionId: "big" });
    expect(big.messages[0]?.text.length).toBeGreaterThan(20_000);
    expect(big.messages[0]?.truncated).toBeUndefined();
    const paged = await client.wsHistory({ kind: "codex", sessionId: "long", limit: 50 });
    expect(paged.messages.length).toBe(50);
    expect(paged.before).not.toBeNull();
    const older = parseHistoryPage(await (await get(`/chats/history?key=0:codex:long&limit=50&before=${paged.before}`)).json());
    expect(older?.messages[49]?.text).toBe("m5457");
    // Ids line up with the ws window so the app can merge pages by id.
    expect(paged.messages[0]?.id.startsWith("av:")).toBe(true);
  });

  test("hermes lineage paging across a compression continuation", async () => {
    const dir = tempDir();
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "root", title: "long hermes", started_at: 1_790_000_000, end_reason: "compression" });
    hz.session({ id: "cont", title: "long hermes (cont)", started_at: 1_790_001_000, parent_session_id: "root" });
    for (let i = 0; i < 30; i++) hz.message(i < 15 ? "root" : "cont", i % 2 ? "assistant" : "user", `h${i}`, 1_790_000_000 + i);
    hz.message("root", "tool", "tool output", 1_790_000_100);
    const engine = new ChatIndexEngine(engineConfig(dir));
    cleanup.push(() => engine.stop());
    await engine.ingest();
    const self = { id: "0", name: "groot" };
    const texts: string[] = [];
    let before: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = await engine.history({ key: "@self:hermes:cont:default", limit: 7, ...(before ? { before } : {}), self });
      texts.unshift(...page.messages.map(m => m.text));
      if (!page.before) break;
      before = page.before;
    }
    expect(texts).toEqual(Array.from({ length: 30 }, (_, i) => `h${i}`));
  });
});

describe("Hermes ws window", () => {
  test("a tool-heavy session that fills the raw window with few messages still gets a cursor that reaches the start", async () => {
    const dir = tempDir();
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "tools", title: "tool heavy", started_at: 1_790_000_000 });
    let t = 1_790_000_000;
    hz.db.transaction(() => {
      for (let turn = 0; turn < 20; turn++) {
        hz.message("tools", "user", `ask ${turn}`, t++);
        hz.message("tools", "assistant", `working on ${turn}`, t++);
        for (let k = 0; k < 40; k++) hz.message("tools", "tool", `out ${turn}.${k}`, t++);
      }
    })();
    const engine = new ChatIndexEngine(engineConfig(dir));
    cleanup.push(() => engine.stop());
    await engine.ingest();
    const window = await engine.hermes.history("default", "tools");
    expect(window.length).toBeLessThan(50);
    const page = hermesWsPage(window, 50);
    expect(page.before).not.toBeNull();
    const self = { id: "0", name: "groot" };
    const asks = new Set(window.filter(m => m.role === "user").map(m => m.text));
    let before: string | null = page.before;
    for (let n = 0; before && n < 50; n++) {
      const older = await engine.history({ key: "@self:hermes:tools:default", limit: 50, before, self });
      for (const m of older.messages) if (m.role === "user") asks.add(m.text);
      before = older.before;
    }
    expect([...asks].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `ask ${i}`).sort());
  });

  test("a short chat gets a cursor too; at the start of the chat the HTTP page is empty with no cursor", async () => {
    const dir = tempDir();
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "short", title: "short", started_at: 1_790_000_000 });
    hz.message("short", "user", "hi", 1_790_000_001);
    hz.message("short", "assistant", "hello", 1_790_000_002);
    const engine = new ChatIndexEngine(engineConfig(dir));
    cleanup.push(() => engine.stop());
    await engine.ingest();
    const page = hermesWsPage(await engine.hermes.history("default", "short"), 50);
    expect(page.messages.map(m => m.text)).toEqual(["hi", "hello"]);
    expect(page.before).not.toBeNull();
    const older = await engine.history({ key: "@self:hermes:short:default", limit: 50, before: page.before ?? undefined, self: { id: "0", name: "groot" } });
    expect(older).toEqual({ messages: [], before: null });
    expect(hermesWsPage([], 50).before).toBeNull();
  });
});
