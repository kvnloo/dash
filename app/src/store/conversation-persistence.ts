import { parseConversation, type Conversation, type Message } from "../model";

export interface ConversationFiles {
  list(area: "durable" | "cache"): Promise<string[]>;
  read(area: "durable" | "cache", name: string): Promise<string | null>;
  write(area: "durable" | "cache", name: string, value: string): Promise<void>;
  remove(area: "durable" | "cache", name: string): Promise<void>;
}
export const CACHE_ENTRY_BYTES = 256 * 1024;
export const CACHE_ENTRIES = 64;
const CACHE_MESSAGES = 80;
const CACHE_VERSION = 1;

function filename(id: string): string { return `${encodeURIComponent(id)}.json`; }
export function uniqueConversationIds(chats: readonly Conversation[]): Conversation[] {
  const used = new Set(chats.map(chat => chat.id));
  const seen = new Set<string>();
  return chats.map(chat => {
    if (!seen.has(chat.id)) { seen.add(chat.id); return chat; }
    let suffix = 2;
    while (used.has(`${chat.id}:recovered:${suffix}`)) suffix++;
    const id = `${chat.id}:recovered:${suffix}`;
    used.add(id); seen.add(id);
    return { ...chat, id };
  });
}
function parse(raw: string | null): Conversation | null {
  if (!raw) return null;
  try { const value: unknown = JSON.parse(raw); return parseConversation(value); } catch { return null; }
}
function pending(message: Message): boolean {
  return message.role === "user" ? message.delivery === "queued" || message.delivery === "failed" || message.delivery === "steering"
    : message.state === "pending" || message.state === "streaming";
}
export function durableConversation(chat: Conversation): Conversation {
  if (!chat.sessionId) return chat;
  const messages = chat.messages.filter((message, index, all) => {
    const next = all[index + 1];
    return pending(message) || (message.role === "user" && next?.role === "assistant" && pending(next));
  });
  return { ...chat, messages: messages.map(message => message.role === "assistant"
    ? { ...message, text: "", seq: 0, parts: undefined, activity: undefined, summaries: undefined } : message) };
}
function fitsCache(value: unknown, budget: { left: number }): boolean {
  if (typeof value === "string") budget.left -= value.length * 6 + 2;
  else if (Array.isArray(value)) {
    budget.left -= value.length + 2;
    for (const child of value) if (!fitsCache(child, budget)) return false;
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      budget.left -= key.length * 6 + 4;
      if (!fitsCache(child, budget)) return false;
    }
  } else budget.left -= 32;
  return budget.left >= 0;
}
function cacheMessages(chat: Conversation): Message[] { return chat.messages.slice(-CACHE_MESSAGES).filter(message => !pending(message)); }
function sameHistory(before: Conversation | undefined, after: Conversation): boolean {
  if (!before || before.sessionId !== after.sessionId || before.harness !== after.harness || before.profileId !== after.profileId || before.targetHostId !== after.targetHostId) return false;
  const a = cacheMessages(before), b = cacheMessages(after);
  return a.length === b.length && a.every((message, index) => message === b[index]);
}
export function cacheConversation(chat: Conversation): string | null {
  const messages = cacheMessages(chat);
  if (!messages.length) return null;
  const snapshot = { ...chat, cacheVersion: CACHE_VERSION, messages };
  // Bound nested tool payloads as well as text before allocating the JSON string.
  if (!fitsCache(snapshot, { left: CACHE_ENTRY_BYTES })) return null;
  return JSON.stringify(snapshot);
}

/** Serializes disk commits while coalescing waiting snapshots to the newest state. */
export class ConversationPersistence {
  private saved = new Map<string, Conversation>();
  private durableValues = new Map<string, string>();
  private cacheOrder: string[] = [];
  private waiting: readonly Conversation[] | undefined;
  private running: Promise<void> | undefined;
  constructor(private readonly files: ConversationFiles) {}

  async load(): Promise<Conversation[]> {
    const chats: Conversation[] = [];
    const names = await this.files.list("durable");
    for (let offset = 0; offset < names.length; offset += 8) {
      const batch = await Promise.all(names.slice(offset, offset + 8).map(async name => {
        try { return parse(await this.files.read("durable", name)); } catch { return null; }
      }));
      for (const chat of batch) if (chat) {
        chats.push(chat);
        this.saved.set(chat.id, chat);
        if (chat.sessionId) this.durableValues.set(chat.id, JSON.stringify(chat));
      }
    }
    this.cacheOrder = (await this.files.list("cache")).filter(name => name.endsWith(".json"));
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async cached(chat: Conversation): Promise<Conversation> {
    if (!chat.sessionId) return chat;
    try {
      const raw = await this.files.read("cache", filename(chat.id));
      if (!raw || raw.length > CACHE_ENTRY_BYTES) return chat;
      const cached = parse(raw);
      if (!cached || cached.id !== chat.id || cached.sessionId !== chat.sessionId ||
        cached.harness !== chat.harness || cached.profileId !== chat.profileId || cached.targetHostId !== chat.targetHostId) return chat;
      const ids = new Set(chat.messages.map(message => message.id));
      return { ...chat, messages: [...cached.messages.filter(message => !ids.has(message.id)), ...chat.messages] };
    } catch { return chat; }
  }

  save(chats: readonly Conversation[]): Promise<void> {
    this.waiting = chats;
    if (!this.running) {
      this.running = Promise.resolve().then(() => this.drain());
    }
    return this.running;
  }
  private async drain(): Promise<void> {
    try {
      while (this.waiting) {
        const chats = this.waiting;
        this.waiting = undefined;
        const keep = new Set(chats.map(chat => chat.id));
        for (const [id] of this.saved) if (!keep.has(id)) {
          const name = filename(id);
          await this.files.remove("durable", name);
          await this.files.remove("cache", name).catch(() => undefined);
          this.saved.delete(id);
          this.durableValues.delete(id);
          this.cacheOrder = this.cacheOrder.filter(entry => entry !== name);
        }
        for (const chat of chats) {
          if (this.saved.get(chat.id) === chat) continue;
          const name = filename(chat.id);
          const durable = JSON.stringify(durableConversation(chat));
          if (this.durableValues.get(chat.id) !== durable) {
            await this.files.write("durable", name, durable);
            if (chat.sessionId) this.durableValues.set(chat.id, durable);
            else this.durableValues.delete(chat.id);
          }
          if (chat.sessionId && !sameHistory(this.saved.get(chat.id), chat)) {
            const cache = cacheConversation(chat);
            try {
              if (cache) {
                await this.files.write("cache", name, cache);
                this.cacheOrder = [...this.cacheOrder.filter(entry => entry !== name), name];
              } else {
                await this.files.remove("cache", name);
                this.cacheOrder = this.cacheOrder.filter(entry => entry !== name);
              }
            } catch { /* A disposable cache cannot block durable drafts or startup. */ }
          }
          this.saved.set(chat.id, chat);
        }
        while (this.cacheOrder.length > CACHE_ENTRIES) {
          const oldest = this.cacheOrder[0];
          if (!oldest) break;
          await this.files.remove("cache", oldest).catch(() => undefined);
          this.cacheOrder.shift();
        }
      }
    } finally { this.running = undefined; }
  }
  async clear(): Promise<void> {
    if (this.running) await this.running;
    for (const area of ["durable", "cache"] satisfies ("durable" | "cache")[]) {
      for (const name of await this.files.list(area)) await this.files.remove(area, name);
    }
    this.saved.clear(); this.durableValues.clear(); this.cacheOrder = [];
  }
}
