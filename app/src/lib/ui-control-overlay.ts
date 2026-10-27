import type { AppRoute } from "./app-route-link";

/**
 * Structural fallback for shared/ui-control.ts (#368), which is not yet on the
 * integration branch. The parsed shared UiControlCommand is assignable here;
 * do not accept unparsed agent input at this reducer boundary.
 */
export type UiControlPointTarget =
  | { readonly testID: string }
  | { readonly x: number; readonly y: number };

export interface UiControlStroke {
  readonly points: readonly (readonly [number, number])[];
}

export type UiControlCommandShape =
  | { readonly type: "point"; readonly id: string; readonly target: UiControlPointTarget; readonly label?: string; readonly ttlMs: number }
  | { readonly type: "draw"; readonly id: string; readonly strokes: readonly UiControlStroke[]; readonly color?: "gold" | "cream"; readonly ttlMs: number }
  | { readonly type: "highlight"; readonly id: string; readonly testID: string; readonly ttlMs: number }
  | { readonly type: "navigate"; readonly id: string; readonly route: AppRoute | "Chat"; readonly conversationId?: string }
  | { readonly type: "clear"; readonly id?: string };

export const MAX_OVERLAY_ITEMS = 8;
export const MAX_OVERLAY_LOG = 50;
export const DISMISS_COOLDOWN_MS = 10_000;

interface OverlayItemBase {
  readonly id: string;
  readonly createdAt: number;
  readonly ttlMs: number;
}

export type OverlayItem =
  | (OverlayItemBase & { readonly kind: "point"; readonly target: UiControlPointTarget; readonly label?: string })
  | (OverlayItemBase & { readonly kind: "draw"; readonly strokes: readonly UiControlStroke[]; readonly color?: "gold" | "cream" })
  | (OverlayItemBase & { readonly kind: "highlight"; readonly testID: string });

export interface PendingNavigate {
  readonly id: string;
  readonly route: AppRoute | "Chat";
  readonly conversationId?: string;
  readonly requestedAt: number;
}

export type OverlayReceiptKind =
  | UiControlCommandShape["type"]
  | "dropped"
  | "expired"
  | "evicted"
  | "dismissed"
  | "disabled"
  | "enabled"
  | "navigated";

export interface OverlayReceipt {
  readonly id: string;
  readonly kind: OverlayReceiptKind;
  readonly at: number;
}

export interface OverlayState {
  readonly enabled: boolean;
  readonly items: readonly OverlayItem[];
  readonly pendingNavigate?: PendingNavigate;
  readonly log: readonly OverlayReceipt[];
  /** Commands before this timestamp are blocked by an explicit user dismissal. */
  readonly dismissedUntil?: number;
  /**
   * Bare user-dismiss has no event time. Fail closed until a valid timestamp
   * arrives, then begin the cooldown; never use the potentially stale lastAt.
   */
  readonly dismissalAwaitingTime?: true;
  /** Latest injected timestamp. Prevents stale commands from evading cooldown. */
  readonly lastAt?: number;
}

export type OverlayEvent =
  | { readonly type: "command"; readonly command: UiControlCommandShape; readonly at: number }
  | { readonly type: "tick"; readonly at: number }
  | { readonly type: "user-dismiss"; readonly at?: number }
  | { readonly type: "disable" }
  | { readonly type: "enable" }
  | { readonly type: "navigated"; readonly id: string; readonly at?: number };

export function createOverlayState(): OverlayState {
  return { enabled: true, items: [], log: [] };
}

function orderedTime(state: OverlayState, at: number): boolean {
  return Number.isFinite(at) && at >= 0 && (state.lastAt === undefined || at >= state.lastAt);
}

function appendLog(log: readonly OverlayReceipt[], entries: readonly OverlayReceipt[]): OverlayReceipt[] {
  return [...log, ...entries].slice(-MAX_OVERLAY_LOG);
}

/** Expiry is inclusive: an item is gone exactly at createdAt + ttlMs. */
function advance(state: OverlayState, at: number): OverlayState {
  // A bare dismissal cannot know the wall clock in a pure reducer. Anchor its
  // 10s cooldown to the first valid injected time, conservatively dropping
  // that event's command even when the previous timestamp is long stale.
  const dismissedUntil = state.dismissalAwaitingTime
    ? at + DISMISS_COOLDOWN_MS : state.dismissedUntil;
  const live = state.items.filter((item) => at < item.createdAt + item.ttlMs);
  const expired = state.items
    .filter((item) => at >= item.createdAt + item.ttlMs)
    .map((item): OverlayReceipt => ({ id: item.id, kind: "expired", at }));
  return {
    ...state,
    items: expired.length === 0 ? state.items : live,
    log: expired.length === 0 ? state.log : appendLog(state.log, expired),
    dismissedUntil: dismissedUntil !== undefined && at >= dismissedUntil
      ? undefined : dismissedUntil,
    dismissalAwaitingTime: undefined,
    lastAt: at,
  };
}

function snapshotItem(
  command: Extract<UiControlCommandShape, { readonly type: "point" | "draw" | "highlight" }>,
  createdAt: number,
): OverlayItem {
  switch (command.type) {
    case "point":
      return {
        kind: "point", id: command.id, createdAt, ttlMs: command.ttlMs,
        target: "testID" in command.target
          ? { testID: command.target.testID }
          : { x: command.target.x, y: command.target.y },
        ...(command.label !== undefined ? { label: command.label } : {}),
      };
    case "draw":
      return {
        kind: "draw", id: command.id, createdAt, ttlMs: command.ttlMs,
        strokes: command.strokes.map((stroke) => ({
          points: stroke.points.map(([x, y]): readonly [number, number] => [x, y]),
        })),
        ...(command.color !== undefined ? { color: command.color } : {}),
      };
    case "highlight":
      return { kind: "highlight", id: command.id, createdAt, ttlMs: command.ttlMs, testID: command.testID };
  }
}

function dropped(state: OverlayState, id: string, at: number): OverlayState {
  return { ...state, log: appendLog(state.log, [{ id, kind: "dropped", at }]) };
}

/**
 * Pure state only: no timers, navigation, drawing side effects, or wall-clock
 * reads. The caller validates wire commands and injects timestamps. An
 * untimed { type: "user-dismiss" } clears immediately and blocks commands
 * until the next valid timestamp plus 10s. UI dismissals should supply
 * at: Date.now() to begin an exact 10s cooldown at the user's interaction.
 */
export function reduceOverlay(state: OverlayState, event: OverlayEvent): OverlayState {
  switch (event.type) {
    case "tick":
      return orderedTime(state, event.at) ? advance(state, event.at) : state;

    case "command": {
      if (!orderedTime(state, event.at)) return state;
      const next = advance(state, event.at);
      const command = event.command;
      const id = command.id ?? "__all__";

      if (!next.enabled || (next.dismissedUntil !== undefined && event.at < next.dismissedUntil)) {
        return dropped(next, id, event.at);
      }

      switch (command.type) {
        case "point":
        case "draw":
        case "highlight": {
          // Duplicate live IDs cannot extend a displayed mark's expiry.
          if (next.items.some((item) => item.id === command.id) || next.pendingNavigate?.id === command.id) {
            return dropped(next, command.id, event.at);
          }
          const overflow = Math.max(0, next.items.length + 1 - MAX_OVERLAY_ITEMS);
          const evictions = next.items.slice(0, overflow)
            .map((item): OverlayReceipt => ({ id: item.id, kind: "evicted", at: event.at }));
          return {
            ...next,
            items: [...next.items.slice(overflow), snapshotItem(command, event.at)],
            log: appendLog(next.log, [...evictions, { id: command.id, kind: command.type, at: event.at }]),
          };
        }
        case "navigate":
          // Only one request may await the caller's explicit acknowledgement.
          if (next.pendingNavigate !== undefined || next.items.some((item) => item.id === command.id)) {
            return dropped(next, command.id, event.at);
          }
          return {
            ...next,
            pendingNavigate: {
              id: command.id, route: command.route, requestedAt: event.at,
              ...(command.conversationId !== undefined ? { conversationId: command.conversationId } : {}),
            },
            log: appendLog(next.log, [{ id: command.id, kind: "navigate", at: event.at }]),
          };

        case "clear":
          return {
            ...next,
            items: command.id === undefined ? [] : next.items.filter((item) => item.id !== command.id),
            pendingNavigate: command.id === undefined || next.pendingNavigate?.id === command.id
              ? undefined : next.pendingNavigate,
            log: appendLog(next.log, [{ id, kind: "clear", at: event.at }]),
          };
      }
    }

    case "navigated": {
      const pending = state.pendingNavigate;
      if (pending === undefined || pending.id !== event.id) return state;
      const at = event.at ?? state.lastAt ?? pending.requestedAt;
      if (!orderedTime(state, at)) return state;
      const next = advance(state, at);
      return {
        ...next,
        pendingNavigate: undefined,
        log: appendLog(next.log, [{ id: event.id, kind: "navigated", at }]),
      };
    }

    case "user-dismiss": {
      if (event.at === undefined) {
        // There is no trustworthy elapsed time in this event. Never start
        // cooldown from lastAt: after a long idle it may already be expired.
        return {
          ...state,
          items: [],
          pendingNavigate: undefined,
          dismissalAwaitingTime: true,
          log: appendLog(state.log, [{ id: "user", kind: "dismissed", at: state.lastAt ?? 0 }]),
        };
      }
      const at = event.at;
      if (!orderedTime(state, at)) return state;
      const next = advance(state, at);
      return {
        ...next,
        items: [],
        pendingNavigate: undefined,
        dismissedUntil: at + DISMISS_COOLDOWN_MS,
        log: appendLog(next.log, [{ id: "user", kind: "dismissed", at }]),
      };
    }

    case "disable":
      if (!state.enabled) return state;
      return {
        ...state,
        enabled: false,
        items: [],
        pendingNavigate: undefined,
        log: appendLog(state.log, [{ id: "system", kind: "disabled", at: state.lastAt ?? 0 }]),
      };

    case "enable":
      if (state.enabled) return state;
      return {
        ...state,
        enabled: true,
        log: appendLog(state.log, [{ id: "system", kind: "enabled", at: state.lastAt ?? 0 }]),
      };
  }
}
