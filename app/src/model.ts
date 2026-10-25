import { parseReplyParts } from "../../shared/reply-parts";
import type { ReplyPart } from "../../shared/protocol";
import type { DetailMode } from "./lib/reply-details";
import { parseChatAttachments, type ChatAttachment, type HarnessInfo, type HostInfo } from "../../shared/protocol";

import { parseSummary, type SummaryInfo } from "../../shared/thinking-summary";
import { unwrapHermesHistoryText } from "./lib/history-display";
import { parseIdentityEnrollment, type IdentityEnrollment } from "./lib/identity-client";

import { parseHandedness, type Handedness } from "./lib/handedness";

export interface Settings {
  handedness?: Handedness;
  /** Opt-in metadata only; the credential is held separately in SecureStore. */
  identity?: IdentityEnrollment;
  /** `host:port` of the bridge, no scheme. */
  address: string;
  token: string;
  /** Harness id to use for new chats. */
  harness: string;
  /** Optional working directory override sent with every turn. */
  cwd?: string;
  /** Product feedback from Main composer, Voice, and row long-press. Default on in beta. */
  inAppFeedback: boolean;
}

export type AssistantState = "pending" | "streaming" | "done" | "error" | "interrupted";

export interface UserMessage {
  delivery?: "steering" | "steered" | "queued" | "started" | "failed";
  deliveryAt?: number;
  deliveryNote?: string;
  id: string;
  role: "user";
  text: string;
  at: number;
  /** Files uploaded to the bridge with this message. */
  attachments?: ChatAttachment[];
}

export interface AssistantMessage {
  delivery?: "steered" | "queued" | "started";
  summaries?: SummaryInfo[];
  id: string;
  role: "assistant";
  text: string;
  at: number;
  state: AssistantState;
  /** Latest tool/thinking status from the harness while streaming. */
  status?: string;
  /** Actual bridge tool/thinking statuses, retained for collapsed activity details. */
  activity?: string[];
  parts?: ReplyPart[];
  /**
   * The host holds this session open elsewhere (CLI/TUI). `queued`: nothing sent yet;
   * `sending`: the owner closed and the reply is going out. Never shown as work.
   */
  handoff?: "queued" | "sending";
  /** Error text when `state` is "error". */
  error?: string;
  /** Bridge turn id; used to re-attach after a reconnect. */
  turnId: string;
  /** Last event sequence number applied. */
  seq: number;
}

export type Message = UserMessage | AssistantMessage;

export interface Conversation {
  /** Default on, including chats saved before this preference existed. */
  deliverQueuedAsOne?: boolean;
  /** A durable merge preview pauses automatic delivery until saved or canceled. */
  queuePreview?: string;
  queueWaitForIdle?: boolean;
  detailMode?: DetailMode;
  summariesEnabled?: boolean;
  id: string;
  harness: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Harness-native session id once the first turn reports it. */
  sessionId?: string;
  /** Working directory on the paired host when this row is a live session. */
  cwd?: string;
  targetHostId?: string;
  profileId?: string;
  profileName?: string;
  messageCount?: number;
  /** Live host surface holding this chat open (e.g. "CLI"); replies wait for it. */
  openIn?: string;
  /** True when the latest successful host roster no longer reports this chat. */
  stale?: boolean;
  messages: Message[];
}

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline";

export interface Connection {
  status: ConnectionStatus;
  host?: string;
  cwd?: string;
  harnesses: HarnessInfo[];
  hosts: HostInfo[];
  /** Human-readable reason for the last failure. */
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSettings(raw: unknown): Settings | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.address !== "string" || typeof raw.token !== "string" || typeof raw.harness !== "string") {
    return null;
  }
  const identity = parseIdentityEnrollment(raw.identity);
  if (raw.identity !== undefined && !identity) return null;
  return {
    ...(identity ? { identity } : {}),
    address: raw.address,
    token: raw.token,
    harness: raw.harness,
    cwd: typeof raw.cwd === "string" && raw.cwd ? raw.cwd : undefined,
    inAppFeedback: raw.inAppFeedback !== false,
    handedness: parseHandedness(raw.handedness),
  };
}

const ASSISTANT_STATES: readonly AssistantState[] = ["pending", "streaming", "done", "error", "interrupted"];

function isAssistantState(value: unknown): value is AssistantState {
  return typeof value === "string" && ASSISTANT_STATES.some((s) => s === value);
}

/** Finite numbers only: NaN/Infinity from a corrupt row must not become timestamps or metrics. */
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Identifiers used as keys or routing targets must contain a non-space character. */
function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalId(value: unknown): string | undefined {
  return nonBlank(value) ? value : undefined;
}

function parseMessage(raw: unknown): Message | null {
  if (!isRecord(raw) || !nonBlank(raw.id) || typeof raw.text !== "string" || !finite(raw.at)) {
    return null;
  }
  if (raw.role === "user") {
    // A present-but-malformed upload list drops the row rather than replaying it as text-only.
    const attachments = parseChatAttachments(raw.attachments);
    if (attachments === null) return null;
    return { id: raw.id, role: "user", text: raw.text, at: raw.at, ...(attachments?.length ? { attachments } : {}), delivery: raw.delivery === "steering" || raw.delivery === "steered" || raw.delivery === "queued" || raw.delivery === "started" || raw.delivery === "failed" ? raw.delivery : undefined, deliveryAt: finite(raw.deliveryAt) ? raw.deliveryAt : undefined, deliveryNote: typeof raw.deliveryNote === "string" ? raw.deliveryNote : undefined };
  }
  if (raw.role === "assistant" && isAssistantState(raw.state) && nonBlank(raw.turnId)) {
    // A corrupt sequence would make re-attach resume from a nonsensical offset.
    if (raw.seq !== undefined && !(typeof raw.seq === "number" && Number.isSafeInteger(raw.seq) && raw.seq >= 0)) return null;
    return {
      id: raw.id,
      role: "assistant",
      text: raw.text,
      delivery: raw.delivery === "steered" || raw.delivery === "queued" || raw.delivery === "started" ? raw.delivery : undefined,
      at: raw.at,
      // A turn that was mid-stream when the app was killed can be re-attached on launch.
      state: raw.state,
      status: typeof raw.status === "string" ? raw.status : undefined,
      parts: parseReplyParts(raw.parts),
      summaries: Array.isArray(raw.summaries) ? raw.summaries.flatMap(item => { const summary = parseSummary(item); return summary ? [summary] : []; }).slice(-64) : undefined,
      activity: Array.isArray(raw.activity) ? raw.activity.filter((item): item is string => typeof item === "string").slice(-32) : undefined,
      handoff: raw.handoff === "queued" || raw.handoff === "sending" ? raw.handoff : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
      turnId: raw.turnId,
      seq: typeof raw.seq === "number" ? raw.seq : 0,
    };
  }
  return null;
}

export function parseConversation(raw: unknown): Conversation | null {
  if (
    !isRecord(raw) ||
    !nonBlank(raw.id) ||
    typeof raw.harness !== "string" ||
    typeof raw.title !== "string" ||
    !finite(raw.createdAt) ||
    !finite(raw.updatedAt) ||
    !Array.isArray(raw.messages)
  ) {
    return null;
  }
  const messages: Message[] = [];
  const seen = new Set<string>();
  for (const m of raw.messages) {
    const parsed = parseMessage(m);
    // Rows are React keys and turn-reattach targets; the first occurrence wins.
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      messages.push(parsed);
    }
  }
  // Project already-received Hermes history for display on app restart.
  // An unsent/pending user turn must retain its exact bytes for replay.
  const displayedMessages: Message[] = raw.harness === "hermes"
    ? messages.map((message, index) => {
        const next = messages[index + 1];
        return message.role === "user" && !(next?.role === "assistant" && next.state === "pending")
          ? { ...message, text: unwrapHermesHistoryText(message.text) }
          : message;
      })
    : messages;
  return {
    id: raw.id,
    harness: raw.harness,
    detailMode: raw.detailMode === "Hide" || raw.detailMode === "Compact" || raw.detailMode === "Full" ? raw.detailMode : undefined,
    title: raw.title,
    summariesEnabled: raw.summariesEnabled === true,
    deliverQueuedAsOne: raw.deliverQueuedAsOne !== false,
    queueWaitForIdle: raw.queueWaitForIdle === true,
    queuePreview: typeof raw.queuePreview === "string" ? raw.queuePreview : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sessionId: optionalId(raw.sessionId),
    cwd: typeof raw.cwd === "string" && raw.cwd ? raw.cwd : undefined,
    targetHostId: optionalId(raw.targetHostId),
    profileId: optionalId(raw.profileId),
    profileName: typeof raw.profileName === "string" ? raw.profileName : undefined,
    messageCount: finite(raw.messageCount) ? raw.messageCount : undefined,
    stale: raw.stale === true,
    messages: displayedMessages,
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalize what a user types into `host:port`. Accepts URLs, trailing slashes, missing port. */
export function normalizeAddress(input: string, defaultPort = 4747): string {
  let s = input.trim().replace(/^(wss?|https?):\/\//i, "").replace(/\/.*$/, "");
  if (!s) return "";
  if (!/:\d+$/.test(s)) s = `${s}:${defaultPort}`;
  return s;
}

export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line || "New chat";
}
