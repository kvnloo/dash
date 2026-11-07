import type { Conversation } from "../model";
import { messageThinking } from "./thinking";
import type { NoticeClass } from "../../../shared/interaction-policy";

export type NotificationTarget = { kind: "chat"; chatId: string } | { kind: "approvals" } | { kind: "notices" };
export interface DashNotice { key: string; title: string; body: string; target: NotificationTarget; class?: NoticeClass; /** Agent report: posts even in the foreground. */ report?: boolean }
/** Agent reports post even in the foreground: the app reconnects (and replays) only while open,
 * so suppressing foreground delivery meant replayed reports never reached the shade. */
export function shouldNotify(input: { foreground: boolean; enabled: boolean; permission: string; report?: boolean }): boolean {
  return (!input.foreground || input.report === true) && input.enabled && input.permission === "granted";
}
export function chatLink(chatId: string): string { return `dash://chat/${encodeURIComponent(chatId)}`; }
export function notificationLink(target: NotificationTarget): string {
  return target.kind === "chat" ? chatLink(target.chatId) : target.kind === "approvals" ? "dash://approvals" : "dash://notices";
}
// One deep-link parser: the hardened checks live in notification-link.ts.
export { parseChatLink, parseNotificationTarget } from "./notification-link";

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
