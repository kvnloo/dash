import type { ChatSummary } from "../../../shared/protocol";
import type { ChatListRow } from "./chat-index";
import { groupLabeler } from "./chat-index";

export interface ChatFilters {
  harness: string | null;
  project: string | null;
  date: "all" | "today" | "week" | "month";
  sort: "recent" | "oldest" | "priority";
}

export const DEFAULT_CHAT_FILTERS: ChatFilters = { harness: null, project: null, date: "all", sort: "recent" };
export const CHAT_DATES: readonly { id: ChatFilters["date"]; label: string }[] = [
  { id: "all", label: "Any date" }, { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" }, { id: "month", label: "Last 30 days" },
];
export const CHAT_SORTS: readonly { id: ChatFilters["sort"]; label: string }[] = [
  { id: "recent", label: "Most recent" }, { id: "oldest", label: "Oldest first" }, { id: "priority", label: "Priority" },
];

export function projectPath(cwd: string | undefined): string | null {
  const path = cwd?.trim().replace(/\\/g, "/");
  return path ? path.replace(/\/+$/, "") || "/" : null;
}

function dateStart(date: ChatFilters["date"], now: number): number {
  if (date === "all") return -Infinity;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (date === "week" ? 6 : date === "month" ? 29 : 0));
  return start.getTime();
}

/** The bridge pages newest first, so dates bound the scan even under priority or oldest sorting. */
export function historyNeeded(filters: ChatFilters, remote: readonly ChatSummary[], now: number): boolean {
  if (filters.date !== "all") return (remote.at(-1)?.lastActivityAt ?? Infinity) >= dateStart(filters.date, now);
  return filters.sort !== "recent" || filters.project !== null;
}

const NO_LIVE_KEYS: ReadonlySet<string> = new Set();

/** Local rows already replace their remote summaries in the merged input. */
export function filterChatRows(rows: readonly ChatListRow[], filters: ChatFilters, now: number, liveKeys: ReadonlySet<string> = NO_LIVE_KEYS): ChatListRow[] {
  const since = dateStart(filters.date, now);
  const groupOf = groupLabeler(now);
  const chats: { row: Extract<ChatListRow, { type: "chat" }>; at: number; priority: number }[] = [];
  for (const row of rows) {
    if (row.type !== "chat") continue;
    const local = row.local;
    const remote = row.remote;
    const at = local?.updatedAt ?? remote?.lastActivityAt ?? 0;
    if (at < since || (filters.harness !== null && (local?.harness ?? remote?.kind) !== filters.harness)) continue;
    if (filters.project !== null && projectPath(local?.cwd ?? remote?.cwd) !== filters.project) continue;
    const live = liveKeys.has(local?.key ?? row.key) || Boolean(local?.sessionId && !local.hostId && liveKeys.has(`any:${local.harness}:${local.sessionId}`));
    const priority = local?.stale ? 3 : local?.attention === "Needs attention" ? 0 : local?.attention === "Running" || remote?.running || live ? 1 : 2;
    chats.push({ row, at, priority });
  }
  chats.sort((a, b) => (filters.sort === "priority" ? a.priority - b.priority : 0)
    || (filters.sort === "oldest" ? a.at - b.at : b.at - a.at)
    || (a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0));
  const result: ChatListRow[] = [];
  const sections = new Map<string, number>();
  let header: Extract<ChatListRow, { type: "section" }> | undefined;
  for (const { row, at, priority } of chats) {
    const title = filters.sort === "priority" && priority !== 2
      ? priority === 0 ? "Needs attention" : priority === 1 ? "Running" : "Ended"
      : groupOf(at);
    if (header?.title !== title) {
      const occurrence = sections.get(title) ?? 0;
      sections.set(title, occurrence + 1);
      header = { type: "section", key: `filtered-${title}-${occurrence}`, title, count: 0 };
      result.push(header);
    }
    header.count++;
    result.push(row);
  }
  return result;
}
