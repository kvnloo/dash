import { describe, expect, test } from "bun:test";
import type { Conversation } from "../model";
import { CONVERSATION_INDEX_KEY } from "./conversation-persistence";
import { CACHE_PREFIX, DRAFTS_KEY, DURABLE_PREFIX, MIGRATED_KEY, pruneArchive, type PruneStorage } from "./prune-archive";

class Storage implements PruneStorage {
  data = new Map<string, string>();
  writes = 0;
  removes = 0;
  failAfterRemoves = Infinity;
  async getItem(key: string) { return this.data.get(key) ?? null; }
  async setItem(key: string, value: string) {
    this.writes += 1;
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    if (this.removes >= this.failAfterRemoves) throw new Error("crash");
    this.removes += 1;
    this.data.delete(key);
  }
  async getAllKeys() { return [...this.data.keys()]; }
}
function chat(id: string, patch: Partial<Conversation> = {}): Conversation {
  return { id, harness: "codex", title: id, createdAt: 1, updatedAt: 10, sessionId: id.split(":").at(-1), messages: [], ...patch };
}
function seed(storage: Storage, chats: Conversation[]): void {
  for (const c of chats) storage.data.set(`${DURABLE_PREFIX}${encodeURIComponent(c.id)}.json`, JSON.stringify(c));
}
const archived = Array.from({ length: 60 }, (_, i) => chat(`live:codex:a${i}`));

describe("prune adopted archive rows", () => {
  test("prunes never-opened rows; keeps pending, cached, active, opened and local-only chats", async () => {
    const storage = new Storage();
    const pending = chat("live:codex:pending", { messages: [{ id: "u", role: "user", text: "unsent", at: 1, delivery: "queued" }] });
    const cached = chat("live:codex:cached");
    const active = chat("live:codex:active");
    const opened = chat("live:codex:opened", { openedAt: 5 });
    const local = chat("phone-1", { sessionId: undefined, harness: "omp", messages: [{ id: "u", role: "user", text: "local text", at: 1 }] });
    seed(storage, [...archived, pending, cached, active, opened, local]);
    storage.data.set(`${CACHE_PREFIX}${encodeURIComponent(cached.id)}.json`, "{}");
    storage.data.set(DRAFTS_KEY, JSON.stringify({ [archived[0]!.id]: { text: "x", at: 1 }, [local.id]: { text: "keep", at: 1 } }));
    const result = await pruneArchive({ storage, activeId: active.id, legacy: false, pause: () => Promise.resolve() });
    expect(result.status).toBe("done");
    expect(result.pruned.sort()).toEqual(archived.map(c => c.id).sort());
    // Kept chats without `openedAt` come back with the stamp to apply in the store.
    expect(result.kept.map(c => c.id).sort()).toEqual([active.id, cached.id, pending.id, local.id].sort());
    expect(result.kept.every(c => c.openedAt === 10)).toBe(true);
    expect([...storage.data.keys()].filter(k => k.startsWith(DURABLE_PREFIX))).toHaveLength(5);
    expect(JSON.parse(storage.data.get(DRAFTS_KEY) ?? "{}")).toEqual({ [local.id]: { text: "keep", at: 1 } });
    // The index belongs to the persistence layer: the prune never writes it.
    expect(storage.data.has(CONVERSATION_INDEX_KEY)).toBe(false);
    expect(storage.data.get(MIGRATED_KEY)).toBe("true");
  });

  test("a candidate the live store no longer allows (opened or written to during the run) keeps its file", async () => {
    const storage = new Storage();
    seed(storage, archived.slice(0, 30));
    const opened = new Set<string>();
    let batches = 0;
    const result = await pruneArchive({
      storage, activeId: null, legacy: false, batchSize: 10,
      pause: async () => { batches += 1; if (batches === 1) opened.add(archived[25]!.id); },
      stillPrunable: id => !opened.has(id),
    });
    expect(result.pruned).not.toContain(archived[25]!.id);
    expect(result.pruned).toHaveLength(29);
    expect(storage.data.has(`${DURABLE_PREFIX}${encodeURIComponent(archived[25]!.id)}.json`)).toBe(true);
  });

  test("idempotent: a second run is skipped and changes nothing", async () => {
    const storage = new Storage();
    seed(storage, archived.slice(0, 3));
    await pruneArchive({ storage, activeId: null, legacy: false });
    const snapshot = new Map(storage.data);
    expect((await pruneArchive({ storage, activeId: null, legacy: false })).status).toBe("skipped");
    expect(storage.data).toEqual(snapshot);
  });

  test("resumes after a crash between batches with the same final state", async () => {
    const keepers = Array.from({ length: 30 }, (_, i) => chat(`live:codex:k${i}`, { openedAt: undefined }));
    const cachedKeys = keepers.map(c => `${CACHE_PREFIX}${encodeURIComponent(c.id)}.json`);
    const make = () => { const s = new Storage(); seed(s, [...archived, ...keepers]); for (const k of cachedKeys) s.data.set(k, "{}"); return s; };
    const clean = make();
    await pruneArchive({ storage: clean, activeId: null, legacy: false, batchSize: 25 });
    const crashed = make();
    crashed.failAfterRemoves = 10;
    await expect(pruneArchive({ storage: crashed, activeId: null, legacy: false, batchSize: 25 })).rejects.toThrow("crash");
    expect(crashed.data.has(MIGRATED_KEY)).toBe(false);
    crashed.failAfterRemoves = Infinity;
    expect((await pruneArchive({ storage: crashed, activeId: null, legacy: false, batchSize: 25 })).status).toBe("done");
    const durable = (s: Storage) => [...s.data.keys()].filter(k => k.startsWith(DURABLE_PREFIX)).sort();
    expect(durable(crashed)).toEqual(durable(clean));
  });

  test("legacy mode (old bridge) skips the prune and leaves the flag unset", async () => {
    const storage = new Storage();
    seed(storage, archived.slice(0, 5));
    expect((await pruneArchive({ storage, activeId: null, legacy: true })).status).toBe("skipped");
    expect([...storage.data.keys()].filter(k => k.startsWith(DURABLE_PREFIX))).toHaveLength(5);
    expect(storage.data.has(MIGRATED_KEY)).toBe(false);
  });
});
