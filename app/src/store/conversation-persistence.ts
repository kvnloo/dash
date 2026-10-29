import { parseConversation, type Conversation, type Message } from "../model";
import { isCatalogHarness } from "../../../shared/catalog";

export function hasHostHistory(chat: Conversation): boolean { return Boolean(chat.sessionId) && isCatalogHarness(chat.harness); }

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
  if (!hasHostHistory(chat)) return chat;
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
  if (!hasHostHistory(chat)) return null;
  const snapshot: Conversation & { cacheVersion: number } = { ...chat, cacheVersion: CACHE_VERSION, messages: [] };
  let budget = { left: CACHE_ENTRY_BYTES };
  if (!fitsCache(snapshot, budget)) return null;
  const messages = cacheMessages(chat);
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message) continue;
    // Tool payloads remain host-owned; keep a bounded suffix of the visible transcript.
    const projected = message.role === "assistant" ? { ...message, parts: undefined } : message;
    const remaining = { left: budget.left - 1 };
    if (!fitsCache(projected, remaining)) break;
    snapshot.messages.unshift(projected);
    budget = remaining;
  }
  return snapshot.messages.length ? JSON.stringify(snapshot) : null;
}

/** The light index of persisted conversations: everything but the transcript. */
export const CONVERSATION_INDEX_KEY = "dash.conversations.index.v3";
export interface IndexStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
export interface IndexedConversations {
  /** Stubs (`messages: []`) for every persisted conversation, newest first. */
  chats: Conversation[];
  /** Ids whose transcripts hold pending or queued sends: load these at startup. */
  pending: string[];
}

function hasPending(chat: Conversation): boolean { return chat.messages.some(pending); }
function previewText(chat: Conversation): string | undefined {
  const last = chat.messages.at(-1);
  const text = last ? last.text.replace(/\s+/g, " ").trim() : chat.preview;
  return text ? text.slice(0, 160) : undefined;
}
/** One index entry: the conversation without messages, plus startup hints. */
export function indexEntry(chat: Conversation): string {
  const { messages: _messages, viewOnly: _viewOnly, ...meta } = chat;
  const preview = previewText(chat);
  const last = chat.messages.at(-1);
  const latestReply = last?.role === "assistant"
    ? { id: last.id, turnId: last.turnId, at: last.at, state: last.state }
    : last ? undefined : chat.latestReply;
  return JSON.stringify({ ...meta, latestReply, ...(preview ? { preview } : {}), hasPending: hasPending(chat) });
}
export function parseIndex(raw: string | null): { chat: Conversation; part: string; hasPending: boolean }[] | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(value)) return null;
  const out: { chat: Conversation; part: string; hasPending: boolean }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const chat = parseConversation({ ...item, messages: [] });
    if (chat) out.push({ chat, part: JSON.stringify(item), hasPending: "hasPending" in item && item.hasPending === true });
  }
  return out;
}

/** Serializes disk commits while coalescing waiting snapshots to the newest state. */
export class ConversationPersistence {
  private saved = new Map<string, Conversation>();
  private durableValues = new Map<string, string>();
  private cacheOrder: string[] = [];
  private waiting: readonly Conversation[] | undefined;
  private running: Promise<void> | undefined;
  /** Conversations hydrated from the index whose durable transcript was not read yet. */
  private unloaded = new Set<string>();
  /** Serialized index entries by id; the index key is written once per drain. */
  private indexParts = new Map<string, string>();
  private indexDirty = false;
  /** Drain generation each saved id was last seen in (deletion without rebuilding a Set). */
  private seen = new Map<string, number>();
  private generation = 0;
  private cacheListed = true;
  /** Save calls so far; each drained snapshot knows which call took it. */
  private saveSeq = 0;
  private waitingSeq = 0;
  /** Ids adopted outside a save: a snapshot taken at or before this save call cannot delete them. */
  private adoptedAt = new Map<string, number>();
  constructor(private readonly files: ConversationFiles, private readonly index?: IndexStore) {}

  /** Startup without reading transcripts: stubs from the index, or null when there is no index yet. */
  async loadIndex(): Promise<IndexedConversations | null> {
    if (!this.index) return null;
    const parsed = parseIndex(await this.index.read());
    if (!parsed) return null;
    this.saved.clear(); this.durableValues.clear(); this.unloaded.clear(); this.indexParts.clear(); this.seen.clear();
    const chats: Conversation[] = [];
    const pendingIds: string[] = [];
    for (const { chat, part, hasPending: waiting } of parsed) {
      if (this.indexParts.has(chat.id)) continue;
      chats.push(chat);
      this.saved.set(chat.id, chat);
      this.unloaded.add(chat.id);
      this.indexParts.set(chat.id, part);
      if (waiting) pendingIds.push(chat.id);
    }
    // The cache listing is only needed for eviction; the first save reads it, not startup.
    this.cacheOrder = [];
    this.cacheListed = false;
    this.indexDirty = false;
    return { chats: chats.sort((a, b) => b.updatedAt - a.updatedAt), pending: pendingIds };
  }

  isLoaded(id: string): boolean { return !this.unloaded.has(id); }
  /** The store now holds the transcript `loadOne` read: saves may write this chat directly. */
  markLoaded(id: string): void { this.unloaded.delete(id); }

  /** Read one conversation's durable transcript on demand (active chat, pending sends). */
  async loadOne(chat: Conversation): Promise<Conversation> {
    if (!this.unloaded.has(chat.id)) return chat;
    let disk: Conversation | null = null;
    try {
      const raw = await this.files.read("durable", filename(chat.id));
      disk = parse(raw);
      if (raw && disk && hasHostHistory(disk)) this.durableValues.set(chat.id, raw);
    } catch { disk = null; }
    if (!disk) return chat;
    const ids = new Set(chat.messages.map(message => message.id));
    const messages = [...disk.messages.filter(message => !ids.has(message.id)), ...chat.messages];
    return { ...disk, ...chat, messages };
  }

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
        this.unloaded.delete(chat.id);
        this.indexParts.set(chat.id, indexEntry(chat));
        if (hasHostHistory(chat)) this.durableValues.set(chat.id, JSON.stringify(chat));
      }
    }
    // The v2 file layout is readable without an index; the next save writes one.
    this.indexDirty = true;
    this.cacheOrder = (await this.files.list("cache")).filter(name => name.endsWith(".json"));
    this.cacheListed = true;
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Durable files the index does not list: a crash between a new chat's file write and the index
   * write, or files an older app wrote. Read-only: returns the parsed chats (full transcripts);
   * the caller puts them in the store and then calls `adopt`.
   */
  async orphans(): Promise<Conversation[]> {
    if (!this.index) return [];
    const out: Conversation[] = [];
    for (const name of await this.files.list("durable")) {
      if (!name.endsWith(".json")) continue;
      let id: string;
      try { id = decodeURIComponent(name.slice(0, -".json".length)); } catch { continue; }
      if (this.indexParts.has(id) || this.saved.has(id)) continue;
      let chat: Conversation | null = null;
      try { chat = parse(await this.files.read("durable", name)); } catch { chat = null; }
      if (chat && chat.id === id) out.push(chat);
    }
    return out;
  }

  /** Register chats found by `orphans` (now in the store) and rewrite the index with them. */
  adopt(chats: readonly Conversation[]): void {
    for (const chat of chats) {
      if (this.indexParts.has(chat.id)) continue;
      this.saved.set(chat.id, chat);
      this.unloaded.delete(chat.id);
      this.indexParts.set(chat.id, indexEntry(chat));
      if (hasHostHistory(chat)) this.durableValues.set(chat.id, JSON.stringify(durableConversation(chat)));
      this.adoptedAt.set(chat.id, this.saveSeq);
      this.indexDirty = true;
    }
  }

  /** The next drain rewrites the whole index key from the in-memory entries. */
  markIndexDirty(): void { this.indexDirty = true; }

  /** Forget conversations removed outside a save (the archive prune) without touching disk. */
  forget(ids: readonly string[]): void {
    for (const id of ids) {
      this.saved.delete(id); this.durableValues.delete(id); this.unloaded.delete(id); this.seen.delete(id); this.adoptedAt.delete(id);
      if (this.indexParts.delete(id)) this.indexDirty = true;
    }
  }

  async cached(chat: Conversation): Promise<Conversation> {
    if (!hasHostHistory(chat)) return chat;
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
    this.waitingSeq = ++this.saveSeq;
    if (!this.running) {
      this.running = Promise.resolve().then(() => this.drain());
    }
    return this.running;
  }
  private async drain(): Promise<void> {
    try {
      while (this.waiting) {
        const chats = this.waiting;
        const seq = this.waitingSeq;
        this.waiting = undefined;
        const generation = ++this.generation;
        for (const chat of chats) {
          this.seen.set(chat.id, generation);
          const adopted = this.adoptedAt.get(chat.id);
          if (adopted !== undefined && seq > adopted) this.adoptedAt.delete(chat.id);
        }
        for (const [id] of this.saved) if (this.seen.get(id) !== generation) {
          const adopted = this.adoptedAt.get(id);
          // Taken before the chat was adopted into the store: absence here is not a delete.
          if (adopted !== undefined && seq <= adopted) continue;
          this.adoptedAt.delete(id);
          const name = filename(id);
          await this.files.remove("durable", name);
          await this.files.remove("cache", name).catch(() => undefined);
          this.saved.delete(id);
          this.durableValues.delete(id);
          this.unloaded.delete(id);
          this.seen.delete(id);
          if (this.indexParts.delete(id)) this.indexDirty = true;
          this.cacheOrder = this.cacheOrder.filter(entry => entry !== name);
        }
        for (const chat of chats) {
          if (this.saved.get(chat.id) === chat) continue;
          const name = filename(chat.id);
          let record = chat;
          if (this.unloaded.has(chat.id) && !hasHostHistory(chat)) {
            // The transcript of a local chat lives only in its durable file: never overwrite it with a stub.
            const disk = parse(await this.files.read("durable", name).catch(() => null));
            if (disk) {
              const ids = new Set(chat.messages.map(message => message.id));
              record = { ...chat, messages: [...disk.messages.filter(message => !ids.has(message.id)), ...chat.messages] };
            }
          }
          const durable = JSON.stringify(durableConversation(record));
          if (this.durableValues.get(chat.id) !== durable) {
            await this.files.write("durable", name, durable);
            if (hasHostHistory(chat)) this.durableValues.set(chat.id, durable);
            else this.durableValues.delete(chat.id);
          }
          if (hasHostHistory(chat) && !this.unloaded.has(chat.id) && !sameHistory(this.saved.get(chat.id), chat)) {
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
          const part = indexEntry(record);
          if (this.indexParts.get(chat.id) !== part) { this.indexParts.set(chat.id, part); this.indexDirty = true; }
          this.saved.set(chat.id, chat);
        }
        if (!this.cacheListed) {
          this.cacheListed = true;
          const listed = (await this.files.list("cache").catch(() => [])).filter(name => name.endsWith(".json"));
          this.cacheOrder = [...listed.filter(name => !this.cacheOrder.includes(name)), ...this.cacheOrder];
        }
        while (this.cacheOrder.length > CACHE_ENTRIES) {
          const oldest = this.cacheOrder[0];
          if (!oldest) break;
          await this.files.remove("cache", oldest).catch(() => undefined);
          this.cacheOrder.shift();
        }
        if (this.index && this.indexDirty) {
          this.indexDirty = false;
          await this.index.write(`[${[...this.indexParts.values()].join(",")}]`);
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
    this.unloaded.clear(); this.indexParts.clear(); this.seen.clear(); this.adoptedAt.clear(); this.indexDirty = false;
    await this.index?.remove();
  }
}
