import type { Conversation } from "../model";

export interface NextActionPermission {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly phase: string;
  readonly deadlineAt: number;
}

export type NextActionKind = "approve" | "retry-send" | "read-reply" | "unstick" | "continue";

export interface NextAction {
  readonly id: string;
  readonly kind: NextActionKind;
  readonly conversationId: string;
  readonly title: string;
  readonly detail: string;
  readonly estimateSec: number;
  readonly why: string;
}

export interface NextActionInput {
  readonly conversations: readonly Conversation[];
  readonly permissions: readonly NextActionPermission[];
  readonly draftTextByConversation: Readonly<Record<string, string>>;
  readonly now: number;
  readonly dismissed: ReadonlySet<string>;
  readonly lastSeen: Readonly<Record<string, number>>;
}

const STREAM_IDLE_MS = 5 * 60_000;
const DRAFT_STALE_MS = 24 * 60 * 60_000;

const PRIORITY: Readonly<Record<NextActionKind, number>> = {
  approve: 0,
  "retry-send": 1,
  "read-reply": 2,
  unstick: 3,
  continue: 4,
};

interface RankedAction {
  readonly action: NextAction;
  readonly priority: number;
  readonly at: number;
}

function validId(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function abbreviate(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit - 1).trimEnd() + "…";
}

/** JSON tuple encoding prevents collisions between IDs containing punctuation. */
function actionId(kind: NextActionKind, ...parts: string[]): string {
  return JSON.stringify([kind, ...parts]);
}

/** Only a fingerprint, never private composer content, goes into persisted dismissal IDs. */
function draftFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return text.length + ":" + (hash >>> 0).toString(16);
}

function candidate(
  kind: NextActionKind,
  id: string,
  chat: Conversation,
  title: string,
  detail: string,
  why: string,
  estimateSec: number,
  at: number,
): RankedAction {
  return {
    action: {
      id,
      kind,
      conversationId: chat.id,
      title: abbreviate(title, 60),
      detail: abbreviate(detail, 90),
      why,
      estimateSec,
    },
    priority: PRIORITY[kind],
    at,
  };
}

/**
 * One deterministic, dismissible suggestion across chats opened on this phone.
 * Priority is fixed; within a priority, the newest underlying observation wins.
 * Permissions must come from trusted parsed state, never assistant text.
 */
export function nextAction(input: NextActionInput): NextAction | null {
  if (!timestamp(input.now)) return null;
  const candidates: RankedAction[] = [];

  for (const chat of input.conversations) {
    if (!validId(chat.id)) continue;
    const name = chat.title.trim() || "this chat";
    for (const permission of input.permissions) {
      if (
        permission.conversationId !== chat.id ||
        !validId(permission.requestId) ||
        !validId(permission.turnId) ||
        !validId(permission.sessionId) ||
        permission.phase !== "pending" ||
        !timestamp(permission.deadlineAt) ||
        permission.deadlineAt <= input.now
      ) continue;
      candidates.push(candidate(
        "approve",
        actionId("approve", chat.id, permission.sessionId, permission.turnId, permission.requestId),
        chat,
        "Review pending approval",
        "A host permission request is waiting in " + name + ".",
        "A current request needs your explicit decision before its deadline.",
        30,
        timestamp(chat.updatedAt) ? chat.updatedAt : 0,
      ));
    }

    for (const message of chat.messages) {
      if (message.role !== "user" || message.delivery !== "failed" || !validId(message.id)) continue;
      candidates.push(candidate(
        "retry-send",
        actionId("retry-send", chat.id, message.id),
        chat,
        "Review failed send",
        "A message in " + name + " needs a delivery check.",
        "A saved user message is marked failed; investigate before sending again.",
        45,
        timestamp(message.deliveryAt ?? message.at) ? (message.deliveryAt ?? message.at) : 0,
      ));
    }

    const message = chat.messages.at(-1);
    const last = message?.role === "assistant" ? message : chat.messages.length === 0 ? chat.latestReply : undefined;
    if (last && validId(last.id)) {
      const eventAt = timestamp(last.at) ? last.at : 0;
      const seen = input.lastSeen[chat.id];
      const seenAt = typeof seen === "number" && Number.isFinite(seen) ? seen : -1;
      if (last.state === "done" && eventAt > seenAt) {
        candidates.push(candidate(
          "read-reply",
          actionId("read-reply", chat.id, last.id, last.turnId),
          chat,
          "Read completed reply",
          "A new assistant reply is ready in " + name + ".",
          "This reply was completed after you last viewed its conversation.",
          45,
          eventAt,
        ));
      }
      const activityAt = Math.max(eventAt, timestamp(chat.updatedAt) ? chat.updatedAt : 0);
      if (
        last.state === "streaming" &&
        input.now - activityAt > STREAM_IDLE_MS
      ) {
        candidates.push(candidate(
          "unstick",
          actionId("unstick", chat.id, last.turnId, last.id),
          chat,
          "Check idle turn",
          name + " has had no recorded update for over five minutes.",
          "The assistant appears idle; inspect the turn before trying to recover it.",
          60,
          activityAt,
        ));
      }
    }

    const draft = input.draftTextByConversation[chat.id];
    if (
      typeof draft === "string" &&
      draft.trim().length > 0 &&
      (chat.stale === true || (timestamp(chat.updatedAt) && input.now - chat.updatedAt >= DRAFT_STALE_MS))
    ) {
      candidates.push(candidate(
        "continue",
        actionId("continue", chat.id, draftFingerprint(draft)),
        chat,
        "Continue unfinished draft",
        name + " has text waiting in the composer.",
        "A saved draft is waiting in an ended or inactive conversation.",
        90,
        timestamp(chat.updatedAt) ? chat.updatedAt : 0,
      ));
    }
  }

  let best: RankedAction | undefined;
  for (const item of candidates) {
    if (input.dismissed.has(item.action.id)) continue;
    if (
      !best ||
      item.priority < best.priority ||
      (item.priority === best.priority && (
        item.at > best.at ||
        (item.at === best.at && item.action.id < best.action.id)
      ))
    ) best = item;
  }
  return best?.action ?? null;
}
