import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseChatSearchPage, type ChatSearchHit } from "../../../shared/protocol";
import { AgentsviewFixture, engineConfig, HermesFixture, inProcessWorker, tempDir } from "../fixtures/chat-index/make-fixtures";
import { ChatIndexClient } from "./client";
import { createChatsHttpHandler } from "./http";
import { markersToHighlights, markSnippet, sanitizeQuery, SNIPPET_MAX } from "./query";
import { ChatIndexEngine } from "./worker";
import { redact } from "../reply-parts";

const SELF = { id: "0", name: "groot" };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });

describe("FTS sanitizer", () => {
  test("quotes every term, escapes quotes, prefixes only a 3+ char last term", () => {
    expect(sanitizeQuery("deploy bridge")?.fts).toBe(`"deploy" "bridge"*`);
    expect(sanitizeQuery("fix ui")?.fts).toBe(`"fix" "ui"`);
    expect(sanitizeQuery(`say "hi" now`)?.fts).toBe(`"say" "hi" "now"*`);
    expect(sanitizeQuery(`x"y`)?.fts).toBe(`"x" "y"`);
    expect(sanitizeQuery(`a"b`)?.fts).toBe(`"b"`);
  });
  test("operators are inert text; punctuation-only input has no terms", () => {
    expect(sanitizeQuery("NEAR(foo bar)")?.fts).toBe(`"NEAR" "foo" "bar"*`);
    expect(sanitizeQuery("foo^bar -baz")?.fts).toBe(`"foo" "bar" "baz"*`);
    expect(sanitizeQuery("foo OR bar")?.fts).toBe(`"foo" "bar"*`);
    expect(sanitizeQuery("*")).toBeNull();
    expect(sanitizeQuery("\" ( ) :")).toBeNull();
  });
  test("stopwords drop only when another term remains", () => {
    expect(sanitizeQuery("the chat list")?.fts).toBe(`"chat" "list"*`);
    expect(sanitizeQuery("the")?.fts).toBe(`"the"*`);
  });
  test("caps at 8 terms of <= 64 chars", () => {
    expect(sanitizeQuery("a1 b2 c3 d4 e5 f6 g7 h8 i9 j10")?.terms.length).toBe(8);
    expect(sanitizeQuery(`${"x".repeat(65)} ok`)?.terms).toEqual(["ok"]);
  });
});

describe("snippet highlights", () => {
  test("markSnippet windows on the first match, marks every needle, cuts with an ellipsis", () => {
    const text = `${"lead ".repeat(100)}then\nDeploy the deploy step ${"tail ".repeat(100)}`;
    const out = markersToHighlights(redact(markSnippet(text, ["deploy"])));
    expect(out.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(out.snippet.startsWith("…")).toBe(true);
    expect(out.snippet.endsWith("…")).toBe(true);
    expect(out.highlights.map(h => out.snippet.slice(h.start, h.end))).toEqual(["Deploy", "deploy"]);
    expect(markersToHighlights(markSnippet("short text, no hit", ["zzz"]))).toEqual({ snippet: "short text, no hit", highlights: [] });
  });
  test("markers become offsets", () => {
    expect(markersToHighlights("the \x01chat\x02 list \x01works\x02")).toEqual({ snippet: "the chat list works", highlights: [{ start: 4, end: 8 }, { start: 14, end: 19 }] });
  });
  test("a marker removed by redaction drops only its highlight", () => {
    const marked = redact("use token=\x01secretvalue\x02 then \x01deploy\x02");
    const out = markersToHighlights(marked);
    expect(out.snippet).not.toContain("secretvalue");
    expect(out.highlights.map(h => out.snippet.slice(h.start, h.end))).toEqual(["deploy"]);
  });
});

function fixture() {
  const dir = tempDir();
  const av = new AgentsviewFixture(join(dir, "av.db"));
  av.session({ id: "codex:c1", agent: "codex", first_message: "Refactor the bridge router", cwd: "/w/dash", ended_at: "2026-10-01T05:00:00Z" });
  av.session({ id: "claude:c2", agent: "claude", first_message: "Kitchen inventory", cwd: "/w/zebra-project", ended_at: "2026-10-01T04:00:00Z" });
  av.session({ id: "codex:gone", agent: "codex", first_message: "automated", is_automated: 1, ended_at: "2026-10-01T06:00:00Z" });
  av.session({ id: "ui", agent: "codex", first_message: "ui polish", ended_at: "2026-10-01T03:00:00Z" });
  const ts = (m: number) => new Date(Date.UTC(2026, 9, 1, 0, m)).toISOString();
  av.message({ session_id: "codex:c1", ordinal: 0, role: "user", content: "please migrate the flamingo schema", timestamp: ts(1) });
  av.message({ session_id: "codex:c1", ordinal: 1, role: "assistant", content: "flamingo migration done", timestamp: ts(2) });
  av.message({ session_id: "codex:c1", ordinal: 2, role: "tool", content: "flamingo tool output", timestamp: ts(3) });
  av.message({ session_id: "codex:c1", ordinal: 3, role: "user", content: "flamingo system injection", timestamp: ts(4), is_system: 1 });
  av.message({ session_id: "claude:c2", ordinal: 0, role: "user", content: "count the flamingo stock with token=sk-abcdefghijklmnopqrstuvwxyz123456", timestamp: ts(5) });
  av.message({ session_id: "codex:gone", ordinal: 0, role: "user", content: "flamingo from an automated run", timestamp: ts(6) });
  return { dir, av };
}

async function ready(dir: string, avPath: string) {
  const engine = new ChatIndexEngine(engineConfig(dir, { agentsviewPath: avPath }));
  cleanup.push(() => engine.stop());
  await engine.ingest();
  await engine.reconcileAgentsview();
  return engine;
}

describe("title phase", () => {
  test("trigram substring over title and cwd", async () => {
    const { dir, av } = fixture();
    const engine = await ready(dir, av.path);
    const router = engine.titleSearch({ q: "outer", qh: "q", limit: 10, kinds: [], hosts: [], self: SELF });
    expect(router.hits.map(h => h.chat.sessionId)).toEqual(["c1"]);
    expect(router.hits[0]).toMatchObject({ field: "title", snippet: "Refactor the bridge router", highlights: [{ start: 21, end: 26 }] });
    const zebra = engine.titleSearch({ q: "zebra", qh: "q", limit: 10, kinds: [], hosts: [], self: SELF });
    expect(zebra.hits[0]).toMatchObject({ field: "cwd", snippet: "/w/zebra-project", highlights: [{ start: 3, end: 8 }] });
  });
  test("1-2 char queries use a prefix/word LIKE", async () => {
    const { dir, av } = fixture();
    const engine = await ready(dir, av.path);
    expect(engine.titleSearch({ q: "ui", qh: "q", limit: 10, kinds: [], hosts: [], self: SELF }).hits.map(h => h.chat.sessionId)).toEqual(["ui"]);
    expect(engine.titleSearch({ q: "br", qh: "q", limit: 10, kinds: [], hosts: [], self: SELF }).hits.map(h => h.chat.sessionId)).toEqual(["c1"]);
    expect(() => engine.titleSearch({ q: "%", qh: "q", limit: 10, kinds: [], hosts: [], self: SELF })).toThrow("bad_request");
  });
});

describe("message phase", () => {
  test("only eligible sessions, one hit per chat, never tool or system rows; redacted snippet", async () => {
    const { dir, av } = fixture();
    const engine = await ready(dir, av.path);
    const page = engine.msgSearch({ q: "flamingo", limit: 10, positions: "start", exclude: [], kinds: [], hosts: [], self: SELF });
    expect(page.hits.map(h => h.chat.sessionId)).toEqual(["c2", "c1"]);
    const c1 = page.hits.find(h => h.chat.sessionId === "c1");
    expect(c1?.role).toBe("assistant");
    expect(c1?.messageId).toMatch(/^av:\d+$/);
    const c2 = page.hits.find(h => h.chat.sessionId === "c2");
    expect(c2?.snippet).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    for (const hit of page.hits) for (const h of hit.highlights) expect(hit.snippet.slice(h.start, h.end).toLowerCase()).toBe("flamingo");
    expect(page.next).toBeNull();
    expect(page.partial).toBe(false);
  });

  test("time budget: partial pages resume with no duplicates and no gaps", async () => {
    const dir = tempDir();
    const av = new AgentsviewFixture(join(dir, "av.db"));
    av.db.transaction(() => {
      for (let i = 0; i < 60; i++) {
        av.session({ id: `codex:s${i}`, agent: "codex", ended_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
        av.message({ session_id: `codex:s${i}`, ordinal: 0, role: "user", content: `needle number ${i}`, timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
        av.message({ session_id: `codex:s${i}`, ordinal: 1, role: "assistant", content: "unrelated", timestamp: new Date(Date.UTC(2026, 0, 1, 0, i, 30)).toISOString() });
      }
    })();
    const engine = await ready(dir, av.path);
    const full = engine.msgSearch({ q: "needle", limit: 50, positions: "start", exclude: [], kinds: [], hosts: [], self: SELF, budgetMs: 1e9 });
    const rest = full.next ? engine.msgSearch({ q: "needle", limit: 50, positions: full.next, exclude: [], kinds: [], hosts: [], self: SELF, budgetMs: 1e9 }) : undefined;
    const reference = [...full.hits, ...(rest?.hits ?? [])].map(h => h.messageId);
    expect(reference.length).toBe(60);
    // Injected clock: each read advances 10 ms; budget 35 ms allows a few rows per page.
    const got: (string | undefined)[] = [];
    let positions: Parameters<ChatIndexEngine["msgSearch"]>[0]["positions"] = "start";
    let partialSeen = false;
    for (let n = 0; n < 200; n++) {
      let t = 0;
      const page = engine.msgSearch({ q: "needle", limit: 50, positions, exclude: [], kinds: [], hosts: [], self: SELF, budgetMs: 35 }, () => (t += 10));
      partialSeen ||= page.partial;
      got.push(...page.hits.map(h => h.messageId));
      if (!page.next) break;
      positions = page.next;
    }
    expect(partialSeen).toBe(true);
    expect(got).toEqual(reference);
  });

  test("scanned-row budget also ends a page early", async () => {
    const { dir, av } = fixture();
    const engine = await ready(dir, av.path);
    const page = engine.msgSearch({ q: "flamingo", limit: 10, positions: "start", exclude: [], kinds: [], hosts: [], self: SELF, maxScanned: 1 });
    expect(page.partial).toBe(true);
    expect(page.hits.length).toBeLessThanOrEqual(1);
    expect(page.next).not.toBeNull();
  });

  test("hermes: trigram substring match for terms with punctuation, plain FTS otherwise", async () => {
    const dir = tempDir();
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "s1", title: "ops" });
    hz.message("s1", "user", "check config at foo.bar-baz.yaml please", 1_790_000_010);
    hz.message("s1", "tool", "foo.bar-baz.yaml tool output", 1_790_000_020);
    hz.session({ id: "s2", title: "other" });
    hz.message("s2", "assistant", "the gateway restarted cleanly", 1_790_000_030);
    const engine = new ChatIndexEngine(engineConfig(dir));
    cleanup.push(() => engine.stop());
    await engine.ingest();
    const tri = engine.msgSearch({ q: "bar-baz.yaml", limit: 10, positions: "start", exclude: [], kinds: [], hosts: [], self: SELF });
    expect(tri.hits.map(h => h.chat.key)).toEqual(["0:hermes:s1:default"]);
    expect(tri.hits[0]?.messageId).toMatch(/^hz:default:\d+$/);
    expect(tri.hits[0]?.role).toBe("user");
    const plain = engine.msgSearch({ q: "gateway restart", limit: 10, positions: "start", exclude: [], kinds: [], hosts: [], self: SELF });
    expect(plain.hits.map(h => h.chat.sessionId)).toEqual(["s2"]);
  });
});

describe("GET /chats/search", () => {
  test("title hits first, then message hits, one per chat; cursor bound to the query", async () => {
    const { dir, av } = fixture();
    av.session({ id: "claude:f3", agent: "claude", first_message: "flamingo naming ideas", ended_at: "2026-09-01T00:00:00Z" });
    const config = engineConfig(dir, { agentsviewPath: av.path });
    const client = new ChatIndexClient({ config, spawn: inProcessWorker(config) });
    cleanup.push(() => client.stop());
    await client.primary.call({ op: "ingest", args: null });
    const handle = createChatsHttpHandler({ authorize: async () => true, client, self: () => ({ id: "0", name: "groot", matches: h => h === "0" }), live: () => [] });
    const get = async (p: string) => { const r = await handle(new Request(`http://b${p}`)); if (!r) throw new Error("unrouted"); return r; };
    const page = parseChatSearchPage(await (await get("/chats/search?q=flamingo")).json());
    const fields = page?.hits.map((h: ChatSearchHit) => `${h.field}:${h.chat.sessionId}`);
    expect(fields).toEqual(["title:f3", "message:c2", "message:c1"]);
    const small = parseChatSearchPage(await (await get("/chats/search?q=flamingo&limit=1")).json());
    expect(small?.hits.length).toBe(1);
    expect((await get(`/chats/search?q=other&cursor=${small?.next}`)).status).toBe(400);
    const second = parseChatSearchPage(await (await get(`/chats/search?q=flamingo&limit=1&cursor=${small?.next}`)).json());
    expect(second?.hits[0]?.field).toBe("message");
    const titles = parseChatSearchPage(await (await get("/chats/search?q=flamingo&in=titles")).json());
    expect(titles?.hits.map(h => h.field)).toEqual(["title"]);
    expect(titles?.next).toBeNull();
    expect((await get("/chats/search?q=%22%20*")).status).toBe(400);
  });
});
