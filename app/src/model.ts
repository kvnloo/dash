import type { HarnessInfo } from "../../shared/protocol";

export interface Settings {
  /** `host:port` of the bridge, no scheme. */
  address: string;
  token: string;
  /** Harness id to use for new chats. */
  harness: string;
  /** Optional working directory override sent with every turn. */
  cwd?: string;
}

export type AssistantState = "pending" | "streaming" | "done" | "error" | "interrupted";

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  at: number;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  text: string;
  at: number;
  state: AssistantState;
  /** Latest tool/thinking status from the harness while streaming. */
  status?: string;
  /** Error text when `state` is "error". */
  error?: string;
  /** Bridge turn id; used to re-attach after a reconnect. */
  turnId: string;
  /** Last event sequence number applied. */
  seq: number;
}

export type Message = UserMessage | AssistantMessage;

export interface Conversation {
  id: string;
  harness: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Harness-native session id once the first turn reports it. */
  sessionId?: string;
  messages: Message[];
}

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline";

export interface Connection {
  status: ConnectionStatus;
  host?: string;
  cwd?: string;
  harnesses: HarnessInfo[];
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
  return {
    address: raw.address,
    token: raw.token,
    harness: raw.harness,
    cwd: typeof raw.cwd === "string" && raw.cwd ? raw.cwd : undefined,
  };
}

const ASSISTANT_STATES: readonly AssistantState[] = ["pending", "streaming", "done", "error", "interrupted"];

function isAssistantState(value: unknown): value is AssistantState {
  return typeof value === "string" && ASSISTANT_STATES.some((s) => s === value);
}

function parseMessage(raw: unknown): Message | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.text !== "string" || typeof raw.at !== "number") {
    return null;
  }
  if (raw.role === "user") return { id: raw.id, role: "user", text: raw.text, at: raw.at };
  if (raw.role === "assistant" && isAssistantState(raw.state) && typeof raw.turnId === "string") {
    return {
      id: raw.id,
      role: "assistant",
      text: raw.text,
      at: raw.at,
      // A turn that was mid-stream when the app was killed can be re-attached on launch.
      state: raw.state,
      status: typeof raw.status === "string" ? raw.status : undefined,
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
    typeof raw.id !== "string" ||
    typeof raw.harness !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.createdAt !== "number" ||
    typeof raw.updatedAt !== "number" ||
    !Array.isArray(raw.messages)
  ) {
    return null;
  }
  const messages: Message[] = [];
  for (const m of raw.messages) {
    const parsed = parseMessage(m);
    if (parsed) messages.push(parsed);
  }
  return {
    id: raw.id,
    harness: raw.harness,
    title: raw.title,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    messages,
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
