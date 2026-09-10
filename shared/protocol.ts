// Wire protocol between the phone app and the laptop bridge.
// One WebSocket; JSON text frames; every message has a `type` discriminant.
// Imported by both `bridge/` and `app/`, so it must stay dependency-free.

export const PROTOCOL_VERSION = 1;

export interface HarnessInfo {
  id: string;
  name: string;
  available: boolean;
}

/** One live or installed agent on a host. `kind` is a harness id when Dash can chat with it. */
export interface AgentInfo {
  id: string;
  name: string;
  kind: string;
  /** running = live process; available = installed; offline = known but down. */
  status: "running" | "available" | "offline";
  detail?: string;
  cwd?: string;
  /** Harness-native session id when this row is a live conversation we can resume. */
  sessionId?: string;
}

/** A machine on the tailnet (this laptop, groot/0, …). */
export interface HostInfo {
  id: string;
  name: string;
  hostname: string;
  online: boolean;
  self: boolean;
  address?: string;
  agents: AgentInfo[];
}

export type ClientMessage =
  | {
      type: "chat";
      /** Client-chosen id for this turn; echoed on every server event for it. */
      id: string;
      harness: string;
      text: string;
      /** Harness-native session id from a previous `session` event, for multi-turn. */
      sessionId?: string;
      /** Working directory on the laptop. Falls back to the bridge default. */
      cwd?: string;
    }
  /**
   * Start a spoken turn. The phone streams the recorded utterance as
   * `voice_chunk`s and closes it with `voice_commit`; the bridge transcribes on
   * this machine and then runs the turn exactly as if the text had been typed.
   */
  | {
      type: "voice_begin";
      id: string;
      harness: string;
      sessionId?: string;
      cwd?: string;
      /** Container the phone recorded, e.g. "audio/m4a". */
      mime: string;
    }
  /** One base64 slice of the utterance, in order. */
  | { type: "voice_chunk"; id: string; data: string }
  /** End of utterance: transcribe what arrived and start the turn. */
  | { type: "voice_commit"; id: string }
  | { type: "cancel"; id: string }
  /**
   * Re-subscribe to turns that were in flight when the socket dropped.
   * `seq` is the last event sequence number the client has for that turn;
   * the bridge replays everything after it.
   */
  | { type: "attach"; turns: { id: string; seq: number }[] };

/** Events that belong to a turn. `seq` is per-turn and strictly increasing from 1. */
export type TurnEvent =
  | { type: "session"; id: string; seq: number; sessionId: string }
  /** What the bridge heard for a spoken turn. Precedes the reply's deltas. */
  | { type: "transcript"; id: string; seq: number; text: string }
  | { type: "delta"; id: string; seq: number; text: string }
  | { type: "status"; id: string; seq: number; text: string }
  | { type: "done"; id: string; seq: number; exitCode: number }
  | { type: "error"; id: string; seq: number; message: string };

export type ServerMessage =
  | {
      type: "hello";
      version: number;
      host: string;
      cwd: string;
      harnesses: HarnessInfo[];
      /** Optional; old bridges omit this. */
      hosts?: HostInfo[];
    }
  /** Reply to `attach` for a turn the bridge no longer knows about. */
  | { type: "lost"; id: string }
  | TurnEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): value is string {
  return typeof value === "string";
}

function num(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optStr(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isAttachEntry(value: unknown): value is { id: string; seq: number } {
  return isRecord(value) && str(value.id) && num(value.seq);
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "chat":
      if (
        str(raw.id) &&
        str(raw.harness) &&
        str(raw.text) &&
        optStr(raw.sessionId) &&
        optStr(raw.cwd)
      ) {
        return {
          type: "chat",
          id: raw.id,
          harness: raw.harness,
          text: raw.text,
          sessionId: raw.sessionId,
          cwd: raw.cwd,
        };
      }
      return null;
    case "voice_begin":
      if (str(raw.id) && str(raw.harness) && str(raw.mime) && optStr(raw.sessionId) && optStr(raw.cwd)) {
        return {
          type: "voice_begin",
          id: raw.id,
          harness: raw.harness,
          mime: raw.mime,
          sessionId: raw.sessionId,
          cwd: raw.cwd,
        };
      }
      return null;
    case "voice_chunk":
      return str(raw.id) && str(raw.data) ? { type: "voice_chunk", id: raw.id, data: raw.data } : null;
    case "voice_commit":
      return str(raw.id) ? { type: "voice_commit", id: raw.id } : null;
    case "cancel":
      return str(raw.id) ? { type: "cancel", id: raw.id } : null;
    case "attach":
      return Array.isArray(raw.turns) && raw.turns.every(isAttachEntry)
        ? { type: "attach", turns: raw.turns }
        : null;
    default:
      return null;
  }
}

function isHarnessInfo(value: unknown): value is HarnessInfo {
  return (
    isRecord(value) &&
    str(value.id) &&
    str(value.name) &&
    typeof value.available === "boolean"
  );
}

const AGENT_STATUSES = ["running", "available", "offline"] as const;

function isAgentStatus(value: unknown): value is AgentInfo["status"] {
  return typeof value === "string" && AGENT_STATUSES.some((s) => s === value);
}

function isAgentInfo(value: unknown): value is AgentInfo {
  if (!isRecord(value) || !str(value.id) || !str(value.name) || !str(value.kind) || !isAgentStatus(value.status)) {
    return false;
  }
  if (value.detail !== undefined && !str(value.detail)) return false;
  if (value.cwd !== undefined && !str(value.cwd)) return false;
  if (value.sessionId !== undefined && !str(value.sessionId)) return false;
  return true;
}

export function parseHosts(raw: unknown): HostInfo[] | undefined {
  if (!Array.isArray(raw) || !raw.every(isHostInfo)) return undefined;
  return raw;
}

function isHostInfo(value: unknown): value is HostInfo {
  return (
    isRecord(value) &&
    str(value.id) &&
    str(value.name) &&
    str(value.hostname) &&
    typeof value.online === "boolean" &&
    typeof value.self === "boolean" &&
    (value.address === undefined || str(value.address)) &&
    Array.isArray(value.agents) &&
    value.agents.every(isAgentInfo)
  );
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "hello":
      if (
        num(raw.version) &&
        str(raw.host) &&
        str(raw.cwd) &&
        Array.isArray(raw.harnesses) &&
        raw.harnesses.every(isHarnessInfo)
      ) {
        return {
          type: "hello",
          version: raw.version,
          host: raw.host,
          cwd: raw.cwd,
          harnesses: raw.harnesses,
          hosts: parseHosts(raw.hosts),
        };
      }
      return null;
    case "lost":
      return str(raw.id) ? { type: "lost", id: raw.id } : null;
    case "session":
      return str(raw.id) && num(raw.seq) && str(raw.sessionId)
        ? { type: "session", id: raw.id, seq: raw.seq, sessionId: raw.sessionId }
        : null;
    case "transcript":
      return str(raw.id) && num(raw.seq) && str(raw.text)
        ? { type: "transcript", id: raw.id, seq: raw.seq, text: raw.text }
        : null;
    case "delta":
      return str(raw.id) && num(raw.seq) && str(raw.text)
        ? { type: "delta", id: raw.id, seq: raw.seq, text: raw.text }
        : null;
    case "status":
      return str(raw.id) && num(raw.seq) && str(raw.text)
        ? { type: "status", id: raw.id, seq: raw.seq, text: raw.text }
        : null;
    case "done":
      return str(raw.id) && num(raw.seq) && num(raw.exitCode)
        ? { type: "done", id: raw.id, seq: raw.seq, exitCode: raw.exitCode }
        : null;
    case "error":
      return str(raw.id) && num(raw.seq) && str(raw.message)
        ? { type: "error", id: raw.id, seq: raw.seq, message: raw.message }
        : null;
    default:
      return null;
  }
}
