import { ConversationPersistence, type ConversationFiles } from "../app/src/store/conversation-persistence";
import type { Conversation } from "../app/src/model";

class MemoryFiles implements ConversationFiles {
  durable = new Map<string, string>(); cache = new Map<string, string>(); bytes = 0; writes = 0;
  async list(area: "durable" | "cache") { return [...this[area].keys()]; }
  async read(area: "durable" | "cache", name: string) { return this[area].get(name) ?? null; }
  async write(area: "durable" | "cache", name: string, text: string) { this[area].set(name, text); this.bytes += new TextEncoder().encode(text).length; this.writes++; }
  async remove(area: "durable" | "cache", name: string) { this[area].delete(name); }
}
const chats: Conversation[] = Array.from({ length: 120 }, (_, i) => ({ id: String(i), sessionId: `host-${i}`, harness: "hermes", title: "synthetic", createdAt: 1, updatedAt: 2,
  messages: Array.from({ length: 40 }, (_, j) => ({ id: `${i}-${j}`, role: "user", text: "x".repeat(1024), at: j })) }));
const runs: unknown[] = [];
for (let trial = 0; trial < 7; trial++) {
  const files = new MemoryFiles(); const store = new ConversationPersistence(files); await store.save(chats);
  files.bytes = 0; files.writes = 0;
  const baseline = () => {
    let bytes = 0; const start = performance.now();
    for (let i = 0; i < 20; i++) { const encoded = JSON.stringify(chats); bytes += new TextEncoder().encode(encoded).length; if (JSON.parse(encoded).length !== 120) throw Error("baseline lost conversations"); }
    return { milliseconds: performance.now() - start, bytes, writes: 20 };
  };
  const candidate = async () => {
    const start = performance.now(); for (let i = 0; i < 20; i++) await store.save(chats);
    return { milliseconds: performance.now() - start, bytes: files.bytes, writes: files.writes };
  };
  const [before, after] = trial % 2 === 0 ? [baseline(), await candidate()] : await (async () => { const after = await candidate(); return [baseline(), after]; })();
  if (after.writes !== 0 || after.bytes !== 0) throw Error("unchanged chats rewritten");
  const first = chats[0]; if (!first) throw Error("missing fixture");
  const next = [{ ...first, title: "changed" }, ...chats.slice(1)]; await store.save(next);
  const restored = await new ConversationPersistence(files).load(); if (restored.length !== 120) throw Error("candidate lost metadata");
  runs.push({ trial, before, after, one_chat_change: { writes: files.writes, bytes: files.bytes }, restored: restored.length });
}
console.log(JSON.stringify({ scope: "synthetic persistence CPU/byte microbenchmark; in-memory filesystem; NOT Android startup, frame time or storage latency", chats: 120, messagesPerChat: 40, textCharacters: 1024, iterations: 20, errors: 0, runs }, null, 2));
