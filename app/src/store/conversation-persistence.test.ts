import { describe, expect, test } from "bun:test";
import { ConversationPersistence, CACHE_ENTRIES, CACHE_ENTRY_BYTES, uniqueConversationIds, durableConversation, cacheConversation, type ConversationFiles } from "./conversation-persistence";
import type { Conversation } from "../model";

class Files implements ConversationFiles {
  durable = new Map<string, string>();
  cache = new Map<string, string>();
  writes: string[] = [];
  reads: string[] = [];
  failCache = false;
  async list(area: "durable" | "cache") { return [...this[area].keys()]; }
  async read(area: "durable" | "cache", name: string) { this.reads.push(`${area}/${name}`); if (area === "cache" && this.failCache) throw Error("cache gone"); return this[area].get(name) ?? null; }
  async write(area: "durable" | "cache", name: string, value: string) { if (area === "cache" && this.failCache) throw Error("no space"); this.writes.push(`${area}/${name}`); this[area].set(name, value); }
  async remove(area: "durable" | "cache", name: string) { this[area].delete(name); }
}
function chat(id = "chat"): Conversation {
  return { id, harness: "hermes", sessionId: `host-${id}`, title: "chat", createdAt: 1, updatedAt: 2,
    messages: [{ id: "u", role: "user", text: "hello", at: 1 }, { id: "a", role: "assistant", text: "host answer", at: 2, state: "done", turnId: "turn", seq: 5 }] };
}

test("duplicate legacy client IDs with different host routes survive as separate conversations", async () => {
  const files = new Files();
  const chats = uniqueConversationIds([chat(), { ...chat(), sessionId: "other-host-session", targetHostId: "other-host" }, chat("chat:recovered:2")]);
  expect(new Set(chats.map(chat => chat.id)).size).toBe(3);
  expect(chats[0]?.id).toBe("chat");
  expect(chats[1]?.id).toBe("chat:recovered:3");
  await new ConversationPersistence(files).save(chats);
  const restored = await new ConversationPersistence(files).load();
  expect(restored).toHaveLength(3);
  expect(restored.find(chat => chat.id === "chat:recovered:3")?.targetHostId).toBe("other-host");
});

test("host history is cache only; local-only conversations remain durable", async () => {
  const files = new Files(); const store = new ConversationPersistence(files);
  const host = chat(); const local = { ...chat("local"), sessionId: undefined };
  await store.save([host, local]);
  expect(JSON.parse(files.durable.get("chat.json") ?? "null").messages).toEqual([]);
  expect(files.cache.get("chat.json")).toContain("host answer");
  expect(files.durable.get("local.json")).toContain("host answer");
  const unknown = { ...chat("api"), harness: "custom-api" };
  expect(durableConversation(unknown)).toBe(unknown);
  expect(cacheConversation(unknown)).toBeNull();
  files.cache.clear();
  const restored = await new ConversationPersistence(files).load();
  expect(restored.find(c => c.id === "chat")?.messages).toEqual([]);
  expect(restored.find(c => c.id === "local")?.messages.at(-1)?.text).toBe("host answer");
});

test("startup reads no host transcript; cache is loaded on demand and cannot replace routing", async () => {
  const files = new Files(); await new ConversationPersistence(files).save([chat()]);
  files.reads = [];
  const store = new ConversationPersistence(files); const rows = await store.load();
  expect(files.reads.every(name => name.startsWith("durable/"))).toBe(true);
  const first = rows[0]; if (!first) throw Error("missing chat");
  expect((await store.cached(first)).messages.at(-1)?.text).toBe("host answer");
  expect(await store.cached({ ...first, targetHostId: "different" })).toEqual({ ...first, targetHostId: "different" });
});

test("queued text and running-turn replay identity survive cache eviction", () => {
  const host = chat(); host.messages.push({ id: "queue", role: "user", text: "unsent", at: 3, delivery: "queued" },
    { id: "running", role: "assistant", text: "partial host text", at: 4, state: "streaming", turnId: "running", seq: 100 });
  const durable = durableConversation(host);
  expect(durable.messages.map(m => m.id)).toEqual(["queue", "running"]);
  expect(durable.messages[0]?.text).toBe("unsent");
  expect(durable.messages[1]).toMatchObject({ turnId: "running", seq: 0, text: "" });
});

test("repeated saves and unrelated active-chat changes do not rewrite history", async () => {
  const files = new Files(); const store = new ConversationPersistence(files);
  const a = chat("a"), b = chat("b"); await store.save([a, b]); files.writes = [];
  await store.save([a, b]); expect(files.writes).toEqual([]);
  await store.save([{ ...a, title: "renamed" }, b]);
  expect(files.writes.every(name => name.includes("a.json"))).toBe(true);
});

test("oversized text is not cached and nested host tool payloads are omitted", () => {
  const host = chat(); host.messages[0] = { id: "big", role: "user", at: 1, text: "x".repeat(CACHE_ENTRY_BYTES) };
  const suffix = cacheConversation(host);
  expect(suffix).toContain("host answer");
  expect(suffix).not.toContain("x".repeat(100));
  expect(cacheConversation({ ...host, messages: host.messages.slice(0, 1) })).toBeNull();
  const nested = chat(); nested.messages.push({ id: "tool", role: "assistant", at: 3, text: "small", state: "done", turnId: "t", seq: 1,
    parts: [{ kind: "tool_output", callId: "tool", text: "x".repeat(CACHE_ENTRY_BYTES), truncated: false }] });
  const cached = cacheConversation(nested);
  expect(cached).not.toBeNull();
  expect(cached).toContain("small");
  expect(cached).not.toContain("tool_output");
});

test("bounded cache evicts history without deleting durable metadata or queues", async () => {
  const files = new Files(); const store = new ConversationPersistence(files);
  await store.save(Array.from({ length: CACHE_ENTRIES + 8 }, (_, i) => chat(String(i))));
  expect(files.cache.size).toBe(CACHE_ENTRIES);
  expect(files.durable.size).toBe(CACHE_ENTRIES + 8);
  for (const text of files.cache.values()) expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(CACHE_ENTRY_BYTES);
});

test("cache corruption and I/O failure do not prevent durable state saving", async () => {
  const files = new Files(); files.failCache = true;
  const store = new ConversationPersistence(files); await store.save([chat()]);
  expect(files.durable.size).toBe(1);
  const host = chat(); expect(await store.cached(host)).toEqual(host);
  files.failCache = false; files.cache.set("chat.json", "broken JSON");
  expect(await store.cached(host)).toEqual(host);
});

test("delete after restart removes the matching disk records", async () => {
  const files = new Files(); await new ConversationPersistence(files).save([chat()]);
  const store = new ConversationPersistence(files); await store.load(); await store.save([]);
  expect(files.durable.size).toBe(0); expect(files.cache.size).toBe(0);
});

test("concurrent saves converge to newest snapshot", async () => {
  const files = new Files(); const store = new ConversationPersistence(files);
  const a = chat(); await Promise.all([store.save([a]), store.save([{ ...a, title: "middle" }]), store.save([{ ...a, title: "latest" }])]);
  expect(files.durable.get("chat.json")).toContain("latest");
  await store.save([]);
  await store.save([chat("after-empty")]);
  expect(files.durable.has("after-empty.json")).toBe(true);
});

class Index {
  value: string | null = null;
  writes = 0;
  reads = 0;
  async read() { this.reads += 1; return this.value; }
  async write(value: string) { this.writes += 1; this.value = value; }
  async remove() { this.value = null; }
}

describe("v3 conversation index", () => {
  test("startup reads only the index; pending chats are flagged for loading", async () => {
    const files = new Files(); const index = new Index();
    const queued = { ...chat("queued"), messages: [...chat("queued").messages, { id: "q", role: "user" as const, text: "later", at: 3, delivery: "queued" as const }] };
    await new ConversationPersistence(files, index).save([chat("a"), chat("b"), queued]);
    files.reads = [];
    const store = new ConversationPersistence(files, index);
    const loaded = await store.loadIndex();
    expect(files.reads).toEqual([]);
    expect(loaded?.chats.map(c => c.id).sort()).toEqual(["a", "b", "queued"]);
    expect(loaded?.chats.every(c => c.messages.length === 0)).toBe(true);
    expect(loaded?.pending).toEqual(["queued"]);
    const stub = loaded?.chats.find(c => c.id === "queued");
    if (!stub) throw Error("missing stub");
    const full = await store.loadOne(stub);
    expect(files.reads).toEqual(["durable/queued.json"]);
    expect(full.messages.map(m => m.id)).toEqual(["q"]);
  });

  test("a save writes the index plus only the changed conversation files", async () => {
    const files = new Files(); const index = new Index();
    const store = new ConversationPersistence(files, index);
    const a = chat("a"), b = chat("b");
    await store.save([a, b]);
    expect(index.writes).toBe(1);
    files.writes = [];
    await store.save([a, b]);
    expect(files.writes).toEqual([]);
    expect(index.writes).toBe(1);
    await store.save([{ ...a, title: "renamed" }, b]);
    expect(files.writes).toEqual(["durable/a.json"]);
    expect(index.writes).toBe(2);
    expect(index.value).toContain("renamed");
    await store.save([b]);
    expect(index.value).not.toContain("renamed");
    expect(files.durable.has("a.json")).toBe(false);
  });

  test("a changed stub of a local chat never overwrites its transcript", async () => {
    const files = new Files(); const index = new Index();
    const local = { ...chat("local"), sessionId: undefined };
    await new ConversationPersistence(files, index).save([local]);
    const store = new ConversationPersistence(files, index);
    const stub = (await store.loadIndex())?.chats[0];
    if (!stub) throw Error("missing stub");
    expect(stub.preview).toBe("host answer");
    await store.save([{ ...stub, title: "renamed" }]);
    const disk = JSON.parse(files.durable.get("local.json") ?? "null");
    expect(disk.title).toBe("renamed");
    expect(disk.messages.map((m: { id: string }) => m.id)).toEqual(["u", "a"]);
  });

  test("without an index the v2 layout loads and the next save writes the index", async () => {
    const files = new Files();
    await new ConversationPersistence(files).save([chat("a")]);
    const index = new Index();
    const store = new ConversationPersistence(files, index);
    expect(await store.loadIndex()).toBeNull();
    const chats = await store.load();
    expect(chats).toHaveLength(1);
    await store.save(chats);
    expect(index.value).toContain("\"id\":\"a\"");
  });
});
