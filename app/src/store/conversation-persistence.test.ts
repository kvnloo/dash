import { expect, test } from "bun:test";
import { ConversationPersistence, CACHE_ENTRIES, CACHE_ENTRY_BYTES, durableConversation, cacheConversation, type ConversationFiles } from "./conversation-persistence";
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

test("host history is cache only; local-only conversations remain durable", async () => {
  const files = new Files(); const store = new ConversationPersistence(files);
  const host = chat(); const local = { ...chat("local"), sessionId: undefined };
  await store.save([host, local]);
  expect(JSON.parse(files.durable.get("chat.json") ?? "null").messages).toEqual([]);
  expect(files.cache.get("chat.json")).toContain("host answer");
  expect(files.durable.get("local.json")).toContain("host answer");
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

test("oversized text and nested tool payloads are not cached", () => {
  const host = chat(); host.messages[0] = { id: "big", role: "user", at: 1, text: "x".repeat(CACHE_ENTRY_BYTES) };
  expect(cacheConversation(host)).toBeNull();
  const nested = chat(); nested.messages.push({ id: "tool", role: "assistant", at: 3, text: "small", state: "done", turnId: "t", seq: 1,
    parts: [{ kind: "tool_output", callId: "tool", text: "x".repeat(CACHE_ENTRY_BYTES), truncated: false }] });
  expect(cacheConversation(nested)).toBeNull();
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
