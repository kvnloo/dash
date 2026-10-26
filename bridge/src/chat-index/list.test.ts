import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseChatPage, type ChatSummary } from "../../../shared/protocol";
import { AgentsviewFixture, engineConfig, HermesFixture, inProcessWorker, tempDir } from "../fixtures/chat-index/make-fixtures";
import { ChatIndexClient } from "./client";
import { createChatsHttpHandler, overlayLive } from "./http";
import { EngineError, ChatIndexEngine } from "./worker";

const SELF = { id: "0", name: "groot" };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });

function iso(ms: number): string { return new Date(ms).toISOString(); }

function bigArchive(n: number) {
  const dir = tempDir();
  const av = new AgentsviewFixture(join(dir, "av.db"));
  av.db.transaction(() => {
    for (let i = 0; i < n; i++) {
      // Ties: every 3 sessions share one ended_at.
      av.session({ id: `${i % 2 ? "codex" : "claude"}:s${String(i).padStart(4, "0")}`, agent: i % 2 ? "codex" : "claude", machine: i % 5 === 0 ? "otherbox" : "groot", ended_at: iso(Date.UTC(2026, 0, 1) + Math.floor(i / 3) * 60_000) });
    }
  })();
  return { dir, av };
}

function harness(dir: string, avPath: string | undefined, live: () => ChatSummary[] = () => []) {
  const config = engineConfig(dir, { agentsviewPath: avPath });
  const client = new ChatIndexClient({ config, spawn: inProcessWorker(config), workers: 2 });
  cleanup.push(() => client.stop());
  const handle = createChatsHttpHandler({
    authorize: async r => r.headers.get("authorization") === "Bearer ok",
    client,
    self: () => ({ id: SELF.id, name: SELF.name, matches: h => h === "0" || h === "groot" }),
    live,
  });
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await handle(new Request(`http://bridge${path}`, { headers: { authorization: "Bearer ok", ...headers } }));
    if (!res) throw new Error("route not handled");
    return res;
  };
  return { client, get, ingest: () => client.primary.call({ op: "ingest", args: null }) };
}

describe("GET /chats keyset paging", () => {
  test("1,000 rows: every row exactly once, in order, across ties", async () => {
    const { dir, av } = bigArchive(1000);
    const h = harness(dir, av.path);
    await h.ingest();
    const seen: ChatSummary[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await h.get(`/chats?limit=37${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      const page = parseChatPage(await res.json());
      if (!page) throw new Error("bad page");
      seen.push(...page.items);
      cursor = page.next;
      pages++;
    } while (cursor && pages < 100);
    expect(seen.length).toBe(1000);
    expect(new Set(seen.map(s => s.key)).size).toBe(1000);
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1]!, b = seen[i]!;
      expect(a.lastActivityAt > b.lastActivityAt || (a.lastActivityAt === b.lastActivityAt && a.key < b.key)).toBe(true);
    }
  });

  test("kind and host filters; host accepts the self alias", async () => {
    const { dir, av } = bigArchive(50);
    const h = harness(dir, av.path);
    await h.ingest();
    const codex = parseChatPage(await (await h.get("/chats?kind=codex&limit=100")).json());
    expect(codex?.items.length).toBe(25);
    expect(codex?.items.every(i => i.kind === "codex")).toBe(true);
    const mine = parseChatPage(await (await h.get("/chats?host=groot&limit=100")).json());
    expect(mine?.items.length).toBe(40);
    expect(mine?.items.every(i => i.hostId === "0")).toBe(true);
    const far = parseChatPage(await (await h.get("/chats?host=machine:otherbox&limit=100")).json());
    expect(far?.items.length).toBe(10);
    const chatable = parseChatPage(await (await h.get("/chats?chatable=1&limit=100")).json());
    expect(chatable?.items.every(i => i.chatable)).toBe(true);
    expect((await h.get("/chats?kind=bad%20kind")).status).toBe(400);
  });

  test("a cursor from another filter is rejected as bad_cursor", async () => {
    const { dir, av } = bigArchive(30);
    const h = harness(dir, av.path);
    await h.ingest();
    const page = parseChatPage(await (await h.get("/chats?limit=5&kind=codex")).json());
    const res = await h.get(`/chats?limit=5&cursor=${page?.next}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "bad_cursor", field: "cursor" });
  });

  test("live overlay: page 1 only, deduplicated by key, flags merged", async () => {
    const { dir, av } = bigArchive(20);
    const live: ChatSummary[] = [
      { key: "0:codex:s0019", kind: "codex", sessionId: "s0019", hostId: "0", hostName: "groot", title: "live tab", startedAt: 1, lastActivityAt: 1, messageCount: 0, origin: "live", chatable: true, running: true },
      { key: "0:omp:tab1", kind: "omp", sessionId: "tab1", hostId: "0", hostName: "groot", title: "OMP", startedAt: 1, lastActivityAt: Date.UTC(2027, 0, 1), messageCount: 0, origin: "live", chatable: true, running: true },
    ];
    const h = harness(dir, av.path, () => live);
    await h.ingest();
    const first = parseChatPage(await (await h.get("/chats?limit=5")).json());
    expect(first?.items[0]?.key).toBe("0:omp:tab1");
    const tab = first?.items.filter(i => i.key === "0:codex:s0019") ?? [];
    expect(tab.length).toBe(1);
    expect(tab[0]).toMatchObject({ running: true, origin: "agentsview" });
    const keys: string[] = [...(first?.items.map(i => i.key) ?? [])];
    let cursor = first?.next ?? null;
    while (cursor) {
      const page = parseChatPage(await (await h.get(`/chats?limit=5&cursor=${cursor}`)).json());
      keys.push(...(page?.items.map(i => i.key) ?? []));
      expect(page?.items.some(i => i.key === "0:omp:tab1")).toBe(false);
      cursor = page?.next ?? null;
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(21);
  });

  test("overlayLive keeps sort order and identity-free merge", () => {
    const a = { key: "0:codex:a", kind: "codex", sessionId: "a", hostId: "0", hostName: "g", title: "a", startedAt: 0, lastActivityAt: 10, messageCount: 1, origin: "agentsview" as const, chatable: true };
    const merged = overlayLive([a], [{ ...a, origin: "live", running: true, lastActivityAt: 5 }]);
    expect(merged).toEqual([{ ...a, running: true }]);
  });

  test("ETag and 304", async () => {
    const { dir, av } = bigArchive(10);
    const h = harness(dir, av.path);
    await h.ingest();
    const first = await h.get("/chats?limit=5");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"\d+-[0-9a-f]{8}"$/);
    const again = await h.get("/chats?limit=5", { "if-none-match": etag ?? "" });
    expect(again.status).toBe(304);
    av.session({ id: "codex:new", agent: "codex", ended_at: "2027-01-01T00:00:00Z" });
    await h.ingest();
    expect((await h.get("/chats?limit=5", { "if-none-match": etag ?? "" })).status).toBe(200);
  });

  test("cold fallback while the sidecar is empty: AgentsView keyset merged with Hermes rows", async () => {
    const { dir, av } = bigArchive(25);
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "h1", title: "hermes chat", started_at: Date.UTC(2026, 0, 1) / 1000 + 300, last_activity_at: Date.UTC(2026, 0, 1) / 1000 + 330 });
    const engine = new ChatIndexEngine(engineConfig(dir, { agentsviewPath: av.path }));
    cleanup.push(() => engine.stop());
    expect(engine.building()).toBe(true);
    // Hermes is ingested first; AgentsView has not been read into the sidecar yet.
    await engine.reconcileHermes();
    const keys: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = engine.list({ limit: 7, ...(cursor ? { cursor } : {}), fh: "f", kinds: [], hosts: [], chatable: false, self: SELF });
      expect(page.building).toBe(true);
      keys.push(...page.items.map(i => i.key));
      if (!page.next) break;
      cursor = page.next;
    }
    expect(keys.length).toBe(26);
    expect(new Set(keys).size).toBe(26);
    expect(keys).toContain("0:hermes:h1:default");
    // The cold cursor is bound to its filter.
    expect(() => engine.list({ limit: 7, cursor, fh: "other", kinds: [], hosts: [], chatable: false, self: SELF })).toThrow(EngineError);
  });

  test("building header while the index is cold", async () => {
    const { dir, av } = bigArchive(5);
    const h = harness(dir, av.path);
    const res = await h.get("/chats");
    expect(res.headers.get("x-dash-index")).toBe("building");
    expect(parseChatPage(await res.json())?.items.length).toBe(5);
  });
});
