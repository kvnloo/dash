import { chatLink, parseChatLink, shouldNotify, type DashNotice } from "./notification-policy";

export type PermissionNoticePhase =
  | "pending"
  | "deciding"
  | "allowed"
  | "denied"
  | "timeout"
  | "expired"
  | "resolved";

/** A permission record, not a prompt or tool payload. deadlineAt is Unix milliseconds. */
export interface PermissionNoticeRequest {
  readonly chatId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly phase: PermissionNoticePhase;
  readonly deadlineAt?: number;
}

export interface PermissionNoticeEnvironment {
  readonly foreground: boolean;
  readonly available: boolean;
  readonly enabled: boolean;
  readonly permission: string;
  readonly now: number;
}

export type PermissionNoticePoster = (notice: DashNotice) => void | Promise<void>;

function validId(id: string): boolean {
  return typeof id === "string" && id.trim().length > 0 && id.length <= 200;
}

/** Collision-free, stable across reconnects; scopes repeated wire ids to their chat. */
export function permissionNoticeKey(request: Pick<PermissionNoticeRequest, "chatId" | "turnId" | "requestId">): string | null {
  if (!validId(request.chatId) || !validId(request.turnId) || !validId(request.requestId)) return null;
  try {
    if (parseChatLink(chatLink(request.chatId)) !== request.chatId) return null;
  } catch {
    return null;
  }
  return "needs-ok:" + JSON.stringify([request.chatId, request.turnId, request.requestId]);
}

function settled(phase: PermissionNoticePhase): boolean {
  return phase === "resolved" || phase === "allowed" || phase === "denied"
    || phase === "timeout" || phase === "expired";
}

/**
 * Keep one observer alive across socket reconnects. Feed pending AND settled
 * records; a terminal observation permanently suppresses stale pending replay.
 * The only side effect is the injected, existing native notice poster.
 */
export function createPermissionNoticeObserver(postNativeNotice: PermissionNoticePoster) {
  const notified = new Set<string>();
  const terminal = new Set<string>();

  return async (requests: readonly PermissionNoticeRequest[], environment: PermissionNoticeEnvironment): Promise<void> => {
    const pending = new Map<string, string>();
    const deciding = new Set<string>();

    // Collect terminal states before emitting: a stale pending duplicate in
    // the same snapshot must not defeat its resolution or expiry.
    for (const request of requests) {
      const key = permissionNoticeKey(request);
      if (!key) continue;
      if (settled(request.phase)) {
        terminal.add(key);
        pending.delete(key);
        continue;
      }
      if (request.phase === "deciding") {
        deciding.add(key);
        pending.delete(key);
        continue;
      }
      if (request.phase !== "pending") continue;
      if (typeof request.deadlineAt !== "number" || !Number.isFinite(request.deadlineAt)
        || !Number.isFinite(environment.now)) continue;
      if (request.deadlineAt <= environment.now) {
        terminal.add(key);
        pending.delete(key);
        continue;
      }
      pending.set(key, request.chatId);
    }

    // Permission is read-only: never request OS permission or touch Expo here.
    if (!environment.available || !shouldNotify(environment)) return;
    for (const [key, chatId] of pending) {
      if (notified.has(key) || terminal.has(key) || deciding.has(key)) continue;
      // Mark before awaiting, so concurrent reconnect snapshots cannot double-post.
      notified.add(key);
      try {
        await postNativeNotice({
          key,
          title: "Needs OK",
          body: "An agent needs a decision. Open Dash to review.",
          target: { kind: "chat", chatId },
        });
      } catch {
        // A failed scheduler attempt can be retried on a later observation.
        notified.delete(key);
      }
    }
  };
}
