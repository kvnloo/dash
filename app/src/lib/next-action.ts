import type { AssistantMessage, Conversation } from "../model";


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
  readonly why: string;
}

export interface NextActionInput {
  readonly scope: string;
  readonly conversations: readonly Conversation[];
  readonly permissions: readonly NextActionPermission[];
  readonly draftTextByConversation: Readonly<Record<string, string>>;
  readonly now: number;
  readonly dismissed: ReadonlySet<string>;
  readonly lastSeen: Readonly<Record<string, string>>;
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
export function replyObservationKey(reply: Pick<AssistantMessage, "id" | "turnId">): string {
  return JSON.stringify([reply.id, reply.turnId]);
}
export function nextActionConversationKey(scope: string, conversationId: string): string {
  return JSON.stringify([scope, conversationId]);
}


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
  label: string,
  why: string,
  at: number,
): RankedAction {
  return {
    action: {
      id,
      kind,
      conversationId: chat.id,
      title: abbreviate(chat.title.trim() || "Untitled chat", 60),
      detail: label,
      why,
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
  if (!timestamp(input.now) || !validId(input.scope)) return null;
  const candidates: RankedAction[] = [];

  for (const chat of input.conversations) {
    if (!validId(chat.id)) continue;
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
        actionId("approve", input.scope, chat.id, permission.sessionId, permission.turnId, permission.requestId),
        chat,
        "Review pending approval",
        "A current request needs your explicit decision before its deadline.",
        timestamp(chat.updatedAt) ? chat.updatedAt : 0,
      ));
    }

    for (const message of chat.messages) {
      if (message.role !== "user" || message.delivery !== "failed" || !validId(message.id)) continue;
      candidates.push(candidate(
        "retry-send",
        actionId("retry-send", input.scope, chat.id, message.id),
        chat,
        "Review failed send",
        "A saved user message is marked failed; investigate before sending again.",
        timestamp(message.deliveryAt ?? message.at) ? (message.deliveryAt ?? message.at) : 0,
      ));
    }

    const latestAssistant = chat.messages.findLast((message): message is AssistantMessage => message.role === "assistant") ?? (chat.messages.length === 0 ? chat.latestReply : undefined);
    const latestCompleted = chat.messages.findLast((message): message is AssistantMessage => message.role === "assistant" && message.state === "done") ??
      (chat.messages.length === 0 && chat.latestReply?.state === "done" ? chat.latestReply : undefined);
    if (latestCompleted && validId(latestCompleted.id)) {
      const eventAt = timestamp(latestCompleted.at) ? latestCompleted.at : 0;
      const seen = input.lastSeen[nextActionConversationKey(input.scope, chat.id)];
      const observation = replyObservationKey(latestCompleted);
      if (observation !== seen) {
        candidates.push(candidate(
          "read-reply",
          actionId("read-reply", input.scope, chat.id, latestCompleted.id, latestCompleted.turnId),
          chat,
          "Read completed reply",
          "This reply has not been viewed in its conversation.",
          eventAt,
        ));
      }
    }
    if (latestAssistant && validId(latestAssistant.id)) {
      const eventAt = timestamp(latestAssistant.at) ? latestAssistant.at : 0;
      const activityAt = Math.max(eventAt, timestamp(chat.updatedAt) ? chat.updatedAt : 0);
      if (
        latestAssistant.state === "streaming" &&
        input.now - activityAt > STREAM_IDLE_MS
      ) {
        candidates.push(candidate(
          "unstick",
          actionId("unstick", input.scope, chat.id, latestAssistant.turnId, latestAssistant.id),
          chat,
          "Check idle turn",
          "The assistant appears idle; inspect the turn before trying to recover it.",
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
        actionId("continue", input.scope, chat.id, draftFingerprint(draft)),
        chat,
        "Continue unfinished draft",
        "A saved draft is waiting in an ended or inactive conversation.",
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
