// Vendored from kvnloo/z0bridge@99f513b src/types.ts. Do not edit here; re-copy on upgrade.
/**
 * z0bridge HTTP API v1 types. Shared by the daemon and the TypeScript client.
 * Keep this file dependency-free so apps can vendor or import it directly.
 */

export const API_VERSION = "v1";

/** Stable harness ids. Only `hermes` is implemented; others are reserved adapter slots. */
export type HarnessId = "hermes" | "omp" | "codex" | "claude" | "grok" | (string & {});

export interface HarnessCapabilities {
  list: boolean;
  history: boolean;
  create: boolean;
  prompt: boolean;
  cancel: boolean;
  stream: boolean;
}

export type ChildState = "stopped" | "starting" | "ready" | "backoff";

export interface ProfileInfo {
  id: string;
  /** The profile's ACP child process state in this daemon. */
  child: ChildState;
  sessions?: number;
}

export interface HarnessInfo {
  id: HarnessId;
  name: string;
  transport: "acp";
  available: boolean;
  version?: string;
  capabilities: HarnessCapabilities;
  profiles: ProfileInfo[];
}

export interface SessionSummary {
  harness: HarnessId;
  profile: string;
  id: string;
  title: string;
  source: string;
  cwd?: string;
  /** Milliseconds since epoch. */
  startedAt: number;
  lastActivityAt: number;
  messageCount: number;
  ended: boolean;
}

export interface Ownership {
  /** True when this daemon may send a turn without an explicit override. */
  promptable: boolean;
  /** Created by this daemon instance (always promptable). */
  ownedByBridge: boolean;
  /** Another surface (CLI, TUI, desktop, messaging, another ACP editor) appears to hold it open. */
  liveElsewhere: boolean;
  /** Hermes platform handoff state, if any. pending/running always refuse. */
  handoffState?: string | null;
  reason?: string;
}

export interface SessionDetail extends SessionSummary {
  ownership: Ownership;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Milliseconds since epoch. */
  at: number;
}

export interface SessionList {
  sessions: SessionSummary[];
  nextCursor?: string;
}

export interface MessageList {
  messages: Message[];
  /** Highest message id returned (pass as `after` to poll). */
  latestId?: string;
}

/** What to do when another surface appears to hold the session open. */
export type OnLive = "refuse" | "queue";

export interface CreateSessionRequest {
  harness: HarnessId;
  profile: string;
  cwd?: string;
  title?: string;
}

export interface StartTurnRequest {
  text: string;
  /** Default `refuse`. `queue` admits the turn into the harness owner's FIFO behind the live surface. */
  onLive?: OnLive;
  /** Let a leading `/command` reach the harness. Off by default: `/new`, `/undo` mutate sessions. */
  allowSlash?: boolean;
}

export type TurnState = "queued" | "running" | "done" | "error" | "cancelled";

export interface TurnInfo {
  id: string;
  harness: HarnessId;
  profile: string;
  sessionId: string;
  state: TurnState;
  createdAt: number;
  endedAt?: number;
  stopReason?: string;
  error?: ApiErrorBody["error"];
  /** Last event sequence number emitted so far. */
  lastSeq: number;
}

export interface StartTurnResponse {
  turnId: string;
  sessionId: string;
  eventsUrl: string;
}

export type TurnEvent =
  | { seq: number; type: "status"; text: string }
  | { seq: number; type: "delta"; text: string }
  | { seq: number; type: "tool"; toolCallId: string; title?: string; status?: string; kind?: string }
  | { seq: number; type: "done"; stopReason: string }
  | { seq: number; type: "error"; code: string; message: string };

export type TurnEventType = TurnEvent["type"];

export type ErrorCode =
  | "unauthorized"
  | "forbidden_host"
  | "forbidden_origin"
  | "bad_request"
  | "not_found"
  | "unknown_harness"
  | "unknown_profile"
  | "live_elsewhere"
  | "handoff_in_progress"
  | "turn_in_flight"
  | "slash_command_refused"
  | "queue_full"
  | "harness_unavailable"
  | "harness_error"
  | "outcome_unknown"
  | "internal";

export interface ApiErrorBody {
  error: { code: ErrorCode | (string & {}); message: string };
}

export interface Health {
  ok: true;
  name: "z0bridge";
  version: string;
  api: typeof API_VERSION;
}
