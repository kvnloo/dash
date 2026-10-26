import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../reply-parts";
import type { HermesListRow, HermesSessions, Profile } from "../hermes-sessions";
import type { HistoryMessage } from "../../../shared/protocol";
import { encodeCursor, firstLine, REDACT_SLACK, SELF_HOST, SNIPPET_SOURCE_MAX } from "./query";
import { internalKey, type NewChatRow, type Sidecar } from "./sidecar";
import { hasTable, type FtsRow } from "./agentsview-src";

// Read-only Hermes access for the chat index. Runs only inside a chat-index worker.

export const HZ_BATCH = 500;

export function hzChatRow(profile: string, row: HermesListRow): NewChatRow | undefined {
  const agent = row.agent;
  if (!agent?.sessionId) return undefined;
  const r = {
    origin: "hermes" as const, kind: "hermes", session_id: agent.sessionId, host_id: SELF_HOST, host_name: "", profile_id: profile,
    agent_id: agent.id, title: redact(firstLine(agent.name)) || `Hermes · ${profile}`, cwd: agent.cwd ?? null,
    started_at: row.startedAt, last_activity_at: agent.lastActivityAt ?? row.startedAt, message_count: agent.messageCount ?? 0,
    chatable: 1, src_id: `${profile}:${agent.sessionId}`,
  };
  return { key: internalKey(r), ...r };
}

/** Incremental pass for every profile, ascending native activity past each profile's high-water mark. */
export async function hermesIngest(hermes: HermesSessions, sidecar: Sidecar, yieldNow: () => Promise<void>): Promise<number> {
  let changed = 0;
  for (const profile of hermes.profiles()) {
    for (;;) {
      const since = Number(sidecar.meta(`hz.${profile.id}.maxTs`) ?? "-1");
      const afterId = sidecar.meta(`hz.${profile.id}.maxId`) ?? "";
      const rows = await hermes.listSince(profile.id, Number.isFinite(since) ? since : -1, afterId, HZ_BATCH);
      const keep: NewChatRow[] = [];
      const hidden: string[] = [];
      for (const row of rows) {
        const chat = hzChatRow(profile.id, row);
        if (chat) keep.push(chat);
        else hidden.push(internalKey({ host_id: SELF_HOST, kind: "hermes", session_id: row.id, profile_id: profile.id }));
      }
      changed += sidecar.upsert(keep) + sidecar.markGone(hidden);
      const last = rows[rows.length - 1];
      if (last) { sidecar.setMeta(`hz.${profile.id}.maxTs`, String(last.activity)); sidecar.setMeta(`hz.${profile.id}.maxId`, last.id); }
      if (rows.length < HZ_BATCH) break;
      await yieldNow();
    }
  }
  return changed;
}

/** Full walk per profile: anything not seen (archived, hidden, deleted, delegated) is marked gone. */
export async function hermesReconcile(hermes: HermesSessions, sidecar: Sidecar, yieldNow: () => Promise<void>): Promise<number> {
  let changed = 0;
  for (const profile of hermes.profiles()) {
    const seen = new Set<string>();
    let since = -1;
    let afterId = "";
    for (;;) {
      const rows = await hermes.listSince(profile.id, since, afterId, HZ_BATCH);
      const keep = rows.flatMap(row => { const chat = hzChatRow(profile.id, row); return chat ? [chat] : []; });
      for (const chat of keep) seen.add(chat.key);
      changed += sidecar.upsert(keep);
      const last = rows[rows.length - 1];
      if (!last || rows.length < HZ_BATCH) break;
      since = last.activity; afterId = last.id;
      await yieldNow();
    }
    changed += sidecar.markGoneExcept("hermes", seen, profile.id);
  }
  return changed;
}

/** Long-lived read-only handles for message search (worker 1). */
export class HermesFts {
  private readonly handles = new Map<string, Database | null>();
  constructor(private readonly hermes: HermesSessions) {}

  profiles(): Profile[] { return this.hermes.profiles(false); }

  db(profile: Profile): Database | undefined {
    if (!this.handles.has(profile.id)) {
      const path = join(profile.home, "state.db");
      let db: Database | null = null;
      if (existsSync(path)) {
        try {
          db = new Database(path, { readonly: true });
          db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=300;");
          if (!hasTable(db, "messages_fts")) { db.close(); db = null; }
        } catch { db = null; }
      }
      this.handles.set(profile.id, db);
    }
    return this.handles.get(profile.id) ?? undefined;
  }

  batch(db: Database, table: "messages_fts" | "messages_fts_trigram", fts: string, below: number, limit: number): FtsRow[] {
    return db.query<{ rid: number; session_id: string; role: string; timestamp: number | null }, [string, number, number]>(
      `select f.rowid as rid, m.session_id, m.role, m.timestamp from ${table} f join messages m on m.id = f.rowid
        where ${table} match ?1 and f.rowid < ?2 and m.role in ('user','assistant') and m.active = 1
        order by f.rowid desc limit ?3`).all(fts, below, limit).map(row => ({ rid: row.rid, session_id: row.session_id, role: row.role, at: (row.timestamp ?? 0) * 1000 }));
  }

  /** Text of one hit for its snippet (primary-key read; see avContent). */
  content(db: Database, rowid: number): string | undefined {
    const raw = db.query<{ c: string | null }, [number, number]>("select substr(content, 1, ?2) as c from messages where id = ?1").get(rowid, SNIPPET_SOURCE_MAX + REDACT_SLACK)?.c;
    return typeof raw === "string" ? plainText(raw) : undefined;
  }

  close(): void { for (const db of this.handles.values()) db?.close(); this.handles.clear(); }
}

/** Hermes stores either plain text or a JSON array of content blocks. */
function plainText(raw: string): string {
  if (!raw.startsWith("[")) return raw;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return raw;
    return value.flatMap(block => (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string" ? [block.text] : [])).join("\n");
  } catch { return raw; }
}

/**
 * The ws window cannot tell whether older history exists: hermesSessions.history reads a raw row
 * window (tool rows included) and merges rows, so a tool-heavy session can fill it with few messages.
 * A non-empty page with a native id therefore always carries a cursor; GET /chats/history answers
 * `{ messages: [], before: null }` at the start of the chat.
 */
export function hermesWsPage(messages: HistoryMessage[], limit: number): { messages: HistoryMessage[]; before: string | null } {
  const page = messages.slice(-limit);
  const oldest = page[0];
  return { messages: page, before: oldest && /^\d+$/.test(oldest.id) ? encodeCursor({ v: 1, t: oldest.at / 1000, i: Number(oldest.id) }) : null };
}
