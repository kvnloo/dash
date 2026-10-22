import { debugNavigationRef } from "../debug/nav";
import { setActive, store } from "../store/app";
import { parseChatLink, type NotificationTarget } from "./notification-policy";
let pending: NotificationTarget | undefined;
export function openNotificationTarget(target: NotificationTarget): void { pending = target; flushNotificationTarget(); }
export function flushNotificationTarget(): void {
  if (!pending || !store.get().hydrated || !debugNavigationRef.isReady()) return;
  const target = pending;
  pending = undefined;
  if (target.kind === "approvals") { debugNavigationRef.navigate("Approvals"); return; }
  if (!store.get().conversations.some(c => c.id === target.chatId)) { debugNavigationRef.navigate("Main", { tab: 1 }); return; }
  setActive(target.chatId);
  debugNavigationRef.navigate("Chat");
}
export function handleChatLink(url: string | null): boolean {
  const chatId = parseChatLink(url);
  if (!chatId) return false;
  openNotificationTarget({ kind: "chat", chatId });
  return true;
}
