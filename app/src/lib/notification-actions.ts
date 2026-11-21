// Actionable "Needs OK" notifications (#555). A pending ACP permission request becomes one
// notification that opens its exact chat when tapped and offers Allow once / Deny buttons.
// Pure: no React Native, no expo imports (unit-tested; the native wiring is device-only).
//
// Safety rules:
// - The notification carries only the request's scope, never an optionId. The option is looked
//   up from the live phone record when the button is pressed, so a stale or forged payload can
//   never choose an option that was not offered.
// - "Allow" maps only to an allow_once option, never allow_always. "Deny" maps to reject_once.
// - The bridge's permission_resolved remains the only grant (store/permissions.ts).

import type { DashNotice } from "./notification-policy";

export const PERMISSION_CATEGORY = "dash.permission";
export type NoticeAction = "allow" | "deny";
export const PERMISSION_ACTIONS: readonly { identifier: NoticeAction; buttonTitle: string; destructive: boolean }[] = [
  { identifier: "allow", buttonTitle: "Allow once", destructive: false },
  { identifier: "deny", buttonTitle: "Deny", destructive: true },
];

export interface PermissionRef { conversationId: string; sessionId: string; turnId: string; requestId: string }
type OptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";
export interface PermissionLike extends PermissionRef {
  readonly options: readonly { optionId: string; kind: OptionKind }[];
  readonly phase: string;
  readonly deadlineAt: number;
}

const MAX_ID = 256;
const okId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID && v.trim().length > 0;

/** Same identifier as the generic "Action needed" reply notice for that turn, so one replaces the other. */
export function permissionNoticeKey(ref: Pick<PermissionRef, "conversationId" | "turnId">): string {
  return `${ref.conversationId}:${ref.turnId}:action`;
}

export function optionForAction(record: Pick<PermissionLike, "options">, action: NoticeAction): string | null {
  const kind: OptionKind = action === "allow" ? "allow_once" : "reject_once";
  return record.options.find(option => option.kind === kind)?.optionId ?? null;
}

/** The notification for one pending request, or null when it is no longer actionable. */
export function permissionNotice(record: PermissionLike, chatTitle: string | undefined, now: number): DashNotice | null {
  if (record.phase !== "pending" || now >= record.deadlineAt) return null;
  const actions = PERMISSION_ACTIONS.map(a => a.identifier).filter(action => optionForAction(record, action) !== null);
  const title = chatTitle?.trim() ? `Needs OK · ${chatTitle.trim().slice(0, 60)}` : "Needs OK";
  return {
    key: permissionNoticeKey(record),
    class: "decision",
    title,
    body: actions.length
      ? "An agent is waiting for permission. Allow once or Deny here, or tap to open the chat."
      : "An agent is waiting for permission. Tap to open the chat.",
    target: { kind: "chat", chatId: record.conversationId },
    permission: { conversationId: record.conversationId, sessionId: record.sessionId, turnId: record.turnId, requestId: record.requestId },
    actions,
  };
}

/** Parse a notification button press. Anything unexpected is ignored (the tap still opens the chat). */
export function parseNoticeAction(actionIdentifier: unknown, data: unknown): { action: NoticeAction; ref: PermissionRef } | null {
  if (actionIdentifier !== "allow" && actionIdentifier !== "deny") return null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const raw: unknown = Reflect.get(data, "permission");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const conversationId: unknown = Reflect.get(raw, "conversationId");
  const sessionId: unknown = Reflect.get(raw, "sessionId");
  const turnId: unknown = Reflect.get(raw, "turnId");
  const requestId: unknown = Reflect.get(raw, "requestId");
  if (!okId(conversationId) || !okId(sessionId) || !okId(turnId) || !okId(requestId)) return null;
  return { action: actionIdentifier, ref: { conversationId, sessionId, turnId, requestId } };
}

/** Which posted permission notices are now stale (settled, deciding elsewhere, expired or gone). */
export function staleNoticeKeys(posted: ReadonlySet<string>, live: readonly PermissionLike[], now: number): string[] {
  const keep = new Set(live.filter(r => r.phase === "pending" && now < r.deadlineAt).map(permissionNoticeKey));
  return [...posted].filter(key => !keep.has(key));
}
