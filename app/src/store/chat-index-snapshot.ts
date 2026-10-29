import { parseChatPage, type ChatSummary } from "../../../shared/protocol";

/** First page of the default chat list, so cold start paints real rows before the network. */
export const HEAD_SNAPSHOT_KEY = "dash.chats.head.v1";
export const HEAD_SNAPSHOT_MAX = 100;

export interface HeadSnapshot {
  items: ChatSummary[];
  next: string | null;
  rev: number;
  etag?: string;
}

export interface SnapshotStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function parseHeadSnapshot(text: string | null): HeadSnapshot | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const page = parseChatPage(raw);
  if (!page) return null;
  const etag = typeof raw === "object" && raw !== null && "etag" in raw && typeof raw.etag === "string" ? raw.etag : undefined;
  return { items: page.items.slice(0, HEAD_SNAPSHOT_MAX), next: page.next, rev: page.rev, ...(etag ? { etag } : {}) };
}

export function serializeHeadSnapshot(snapshot: HeadSnapshot): string {
  return JSON.stringify({ items: snapshot.items.slice(0, HEAD_SNAPSHOT_MAX), next: snapshot.next, rev: snapshot.rev, ...(snapshot.etag ? { etag: snapshot.etag } : {}) });
}

export async function loadHeadSnapshot(storage: SnapshotStorage, scope: string): Promise<HeadSnapshot | null> {
  try {
    const text = await storage.getItem(HEAD_SNAPSHOT_KEY);
    if (!text) return null;
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || !("scope" in raw) || raw.scope !== scope) return null;
    return parseHeadSnapshot(text);
  } catch { return null; }
}

// Serialize writes to the one bounded cache slot, including writes already in progress
// when pairing changes. The scope envelope makes an old final write unusable elsewhere.
let pendingWrite: Promise<void> = Promise.resolve();
export function saveHeadSnapshot(storage: SnapshotStorage, snapshot: HeadSnapshot, scope: string): Promise<void> {
  pendingWrite = pendingWrite.then(async () => {
    try { await storage.setItem(HEAD_SNAPSHOT_KEY, JSON.stringify({ ...JSON.parse(serializeHeadSnapshot(snapshot)), scope })); } catch { /* Cache only. */ }
  });
  return pendingWrite;
}
