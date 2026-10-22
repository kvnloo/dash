import type { Conversation } from "../model";
import { messageThinking } from "./thinking";

export type NotificationTarget = { kind: "chat"; chatId: string } | { kind: "approvals" };
export interface DashNotice { key: string; title: string; body: string; target: NotificationTarget }
export function shouldNotify(input: { foreground: boolean; enabled: boolean; permission: string }): boolean {
  return !input.foreground && input.enabled && input.permission === "granted";
}
export function chatLink(chatId: string): string { return `dash://chat/${encodeURIComponent(chatId)}`; }
export function parseChatLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "dash:" || parsed.hostname !== "chat" || parsed.search || parsed.hash) return null;
    const id = decodeURIComponent(parsed.pathname.slice(1));
    return id && id.length <= 200 && !/[\/\x00-\x1f]/.test(id) ? id : null;
  } catch { return null; }
}
export function parseNotificationTarget(data: unknown): NotificationTarget | null {
  if (typeof data !== "object" || data === null) return null;
  const url: unknown = Reflect.get(data, "url");
  if (url === "dash://approvals") return { kind: "approvals" };
  const chatId = typeof url === "string" ? parseChatLink(url) : null;
  return chatId ? { kind: "chat", chatId } : null;
}

export function createReplyNoticeObserver(emit: (notice: DashNotice) => void) {
  let previous = new Map<string, { state: string; waiting: boolean }>();
  let initialized = false;
  const seen = new Set<string>();
  return (conversations: readonly Conversation[]) => {
    const next = new Map<string, { state: string; waiting: boolean }>();
    for (const chat of conversations) for (const message of chat.messages) {
      if (message.role !== "assistant") continue;
      const key = `${chat.id}:${message.turnId}`;
      const waiting = messageThinking(message).phase === "waiting-approval";
      next.set(key, { state: message.state, waiting });
      const old = previous.get(key);
      if (!initialized || !old || (old.state !== "streaming" && old.state !== "pending")) continue;
      const kind = message.state === "done" ? "completed" : message.state === "error" ? "error" : waiting && !old.waiting ? "action" : null;
      if (!kind) continue;
      const eventKey = `${key}:${kind}`;
      if (seen.has(eventKey)) continue;
      seen.add(eventKey);
      if (seen.size > 512) { const first = seen.values().next().value; if (first) seen.delete(first); }
      emit({ key: eventKey, title: kind === "completed" ? "Reply ready" : kind === "action" ? "Action needed" : "Reply failed",
        body: kind === "completed" ? "Open Dash to read the reply." : kind === "action" ? "An agent needs your approval or clarification." : "Open Dash to review the error.",
        target: { kind: "chat", chatId: chat.id } });
    }
    previous = next;
    initialized = true;
  };
}
