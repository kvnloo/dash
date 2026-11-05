import { parseConversation, type Conversation, type Message } from "../model";

/**
 * One-time migration for chats.v1 bridges. Older apps adopted every archived host chat into a
 * persisted conversation. Those never-opened rows now come from the paged list, so their durable
 * files are pruned. The live store is the authority: each candidate is re-checked against it
 * (`stillPrunable`) right before its file goes, and the index is left to the persistence layer
 * (the caller marks it dirty), so a chat opened or created during the run is never lost.
 * Idempotent and safe to interrupt: until the flag is written a crash re-runs it.
 */
export const MIGRATED_KEY = "dash.chats.migrated.v3";
export const DURABLE_PREFIX = "dash.durable.files.v2/";
export const CACHE_PREFIX = "dash.cache.files.v2/";
export const DRAFTS_KEY = "dash.composerDrafts.v1";
export const PRUNE_BATCH = 25;

export interface PruneStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export interface PruneOptions {
  storage: PruneStorage;
  activeId: string | null;
  /** Old bridge: no paged list to recover pruned rows from, so nothing is pruned. */
  legacy: boolean;
  batchSize?: number;
  /** Yield between batches (setTimeout(0) in the app). */
  pause?: () => Promise<void>;
  /** Asked right before each removal: false keeps the file (opened, active or written to since the scan). */
  stillPrunable?: (id: string) => boolean;
}

export interface PruneResult {
  status: "done" | "skipped";
  /** Ids whose durable files were removed. */
  pruned: string[];
  /** Kept conversations that had no `openedAt`, with the stamp the caller should apply. */
  kept: { id: string; openedAt: number }[];
}

function pendingMessage(message: Message): boolean {
  return message.role === "user" ? message.delivery === "queued" || message.delivery === "failed" || message.delivery === "steering"
    : message.state === "pending" || message.state === "streaming";
}

/** A never-opened, adopted archive row with nothing unsent. */
export function shouldPrune(chat: Conversation, ctx: { cached: boolean; activeId: string | null }): boolean {
  return chat.id.startsWith("live:") && !chat.messages.some(pendingMessage) && !ctx.cached && chat.id !== ctx.activeId && chat.openedAt === undefined;
}

export async function pruneArchive(options: PruneOptions): Promise<PruneResult> {
  const { storage } = options;
  if (options.legacy || (await storage.getItem(MIGRATED_KEY)) === "true") return { status: "skipped", pruned: [], kept: [] };
  const keys = await storage.getAllKeys();
  const cached = new Set<string>();
  const durable: string[] = [];
  for (const key of keys) {
    if (key.startsWith(CACHE_PREFIX)) cached.add(key.slice(CACHE_PREFIX.length));
    else if (key.startsWith(DURABLE_PREFIX)) durable.push(key.slice(DURABLE_PREFIX.length));
  }
  const size = Math.max(1, options.batchSize ?? PRUNE_BATCH);
  const pruned: string[] = [];
  const kept: { id: string; openedAt: number }[] = [];
  for (let offset = 0; offset < durable.length; offset += size) {
    if (offset > 0) await options.pause?.();
    for (const name of durable.slice(offset, offset + size)) {
      let chat: Conversation | null = null;
      try {
        const raw = await storage.getItem(DURABLE_PREFIX + name);
        chat = raw ? parseConversation(JSON.parse(raw)) : null;
      } catch { chat = null; }
      // Unreadable files (and the migration marker) are left exactly as they are.
      if (!chat) continue;
      if (shouldPrune(chat, { cached: cached.has(name), activeId: options.activeId }) && (options.stillPrunable?.(chat.id) ?? true)) {
        await storage.removeItem(DURABLE_PREFIX + name);
        pruned.push(chat.id);
        continue;
      }
      if (chat.openedAt === undefined) kept.push({ id: chat.id, openedAt: chat.updatedAt });
    }
  }
  if (pruned.length) {
    try {
      const raw = await storage.getItem(DRAFTS_KEY);
      const drafts: unknown = raw ? JSON.parse(raw) : undefined;
      if (drafts && typeof drafts === "object" && !Array.isArray(drafts)) {
        const gone = new Set(pruned);
        const next: Record<string, unknown> = {};
        let removed = false;
        for (const [id, draft] of Object.entries(drafts)) {
          if (gone.has(id)) removed = true; else next[id] = draft;
        }
        if (removed) await storage.setItem(DRAFTS_KEY, JSON.stringify(next));
      }
    } catch { /* Drafts are a convenience; a bad record cannot block the migration. */ }
  }
  await storage.setItem(MIGRATED_KEY, "true");
  return { status: "done", pruned, kept };
}
