import type { Conversation } from "../model";
import type { SendMode } from "./composer-mode";

export function attachedConversation(conversations: Conversation[], id: string | null): Conversation | undefined {
  return conversations.find(c => c.id === id);
}

export function deliveryPlan(mode: SendMode, busy: boolean, phase: string, streaming: boolean): "send" | "queue" | "wait" {
  if (mode === "steer") return "send";
  if (!busy && phase === "idle") return "send";
  return !streaming && phase !== "idle" ? "wait" : "queue";
}

export type PeekState = { expanded: boolean; revision: string; until: number };
export type PeekEvent = { kind: "activity"; revision: string; now: number } | { kind: "send"; now: number } | { kind: "tuck" } | { kind: "tick"; now: number };
export const PEEK_IDLE: PeekState = { expanded: false, revision: "", until: 0 };
export function peekTransition(state: PeekState, event: PeekEvent): PeekState {
  if (event.kind === "tuck") return { ...state, expanded: false, until: 0 };
  if (event.kind === "tick") return state.expanded && event.now >= state.until ? { ...state, expanded: false } : state;
  if (event.kind === "activity" && event.revision === state.revision) return state;
  return { expanded: true, revision: event.kind === "activity" ? event.revision : state.revision, until: event.now + 6000 };
}
