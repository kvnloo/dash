// Wire protocol between the phone app and the laptop bridge.
// One WebSocket; JSON text frames; every message has a `type` discriminant.
// Imported by both `bridge/` and `app/`, so it must stay dependency-free.

import { isGateItem, parseGateDecision, type GateItem, type GateDecision } from "./gate";
import { parseLiveClientMessage, parseLiveServerMessage, type LiveClientMessage, type LiveServerMessage } from "./live";
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
  hostId?: string;
  profileId?: string;
  /** Persisted session metadata. A listed chat need not have a running process. */
  lastActivityAt?: number;
  messageCount?: number;
  source?: string;
  /** A live host surface (e.g. "CLI") holds this persisted chat open. Dash replies wait for it. */
  openIn?: string;
}

/** One messaging surface a bot is bound to (telegram, discord, …) and its last reported link state. */
export interface BotChannel {
  platform: string;
  /** `configured`: enabled in config, no live gateway reports it. */
  state: "connected" | "retrying" | "disconnected" | "configured";
}

/**
 * A deployed bot identity: something people message on a chat platform (a Hermes gateway
 * profile bound to Telegram/Discord, OpenDots, GrokBot). Not a harness, not a chat.
 */
export interface BotInfo {
  id: string;
  name: string;
  /** What runs it, e.g. "hermes" (gateway profile) or "service" (a user unit). */
  runtime: string;
  /** running = a live gateway/service reports it; available = configured but not live. */
  status: "running" | "available" | "offline";
  channels: BotChannel[];
  /** Roster agent id to open a chat with this bot's profile, when Dash can. */
  agentId?: string;
  detail?: string;
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
  /** Deployed bots on this host. Optional; old bridges omit it. */
  bots?: BotInfo[];
}

/**
 * A file the phone uploaded with `POST /attachments` before sending its turn. The bridge
 * resolves `id` to the stored file; the phone never names a host path.
 */
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** Per-file upload cap, enforced on both sides. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 8;
/** Upload ids are 128-bit random hex minted by the bridge. */
export const ATTACHMENT_ID = /^[a-f0-9]{32}$/;

export type GateClientMessage =
  | { type: "gate_list" }
  | { type: "gate_decide"; decision: GateDecision }
  | { type: "gate_post"; id: string };
export type GateServerMessage =
  | { type: "gate_snapshot"; items: GateItem[]; dry_run: boolean; owner_decisions?: boolean }
  | { type: "gate_status"; id: string; message: string }
  | { type: "gate_error"; message: string };

export type ClientMessage =
  | GateClientMessage
  | LiveClientMessage
  | {
      type: "chat";
      /** Client-chosen id for this turn; echoed on every server event for it. */
      id: string;
      harness: string;
      text: string;
      /** Harness-native session id from a previous `session` event, for multi-turn. */
      sessionId?: string;
      hostId?: string;
      profileId?: string;
      /** Working directory on the laptop. Falls back to the bridge default. */
      cwd?: string;
      /** Files uploaded for this turn. Optional; old phones omit it. */
      attachments?: ChatAttachment[];
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
      hostId?: string;
      profileId?: string;
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
  | { type: "attach"; turns: { id: string; seq: number }[] }
  /** Replay a live harness transcript into the open Chat. Unknown harness ids fail closed. */
  | { type: "history"; harness: string; sessionId: string; cwd?: string; hostId?: string; profileId?: string };

/** One user or assistant turn from a harness session file. */
export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
}

/** Native ACP tool/plan update retained beside the legacy status text. */
export interface AcpStatus {
  sessionId: string;
  update: Record<string, unknown>;
}

/**
 * A reply waiting for an ordered handoff: a live host surface (CLI/TUI) holds the
 * session, so the bridge holds the reply until it closes. `queued` = nothing sent yet.
 */
export interface HandoffInfo {
  state: "queued" | "sending";
  surface: string;
  host: string;
}

/** Events that belong to a turn. `seq` is per-turn and strictly increasing from 1. */
export type TurnEvent =
  | { type: "session"; id: string; seq: number; sessionId: string; hostId?: string; profileId?: string; harnessId?: string; transport?: string }
  /** What the bridge heard for a spoken turn. Precedes the reply's deltas. */
  | { type: "transcript"; id: string; seq: number; text: string }
  | { type: "delta"; id: string; seq: number; text: string }
  | { type: "status"; id: string; seq: number; text: string; acp?: AcpStatus; handoff?: HandoffInfo }
  | { type: "done"; id: string; seq: number; exitCode: number }
  | { type: "error"; id: string; seq: number; message: string };

export type ServerMessage =
  | GateServerMessage
  | LiveServerMessage
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
  /** Live session transcript for `history`. Empty `messages` if the harness is unknown. */
  | { type: "history"; harness: string; sessionId: string; messages: HistoryMessage[]; hostId?: string; profileId?: string }
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

export function parseChatAttachment(value: unknown): ChatAttachment | null {
  if (!isRecord(value) || !str(value.id) || !ATTACHMENT_ID.test(value.id) || !str(value.name) || !str(value.mime) || !num(value.size)) return null;
  if (value.name.length === 0 || value.name.length > 255 || value.size < 0 || value.size > MAX_ATTACHMENT_BYTES || !Number.isInteger(value.size)) return null;
  return { id: value.id, name: value.name, mime: value.mime, size: value.size };
}

/** `undefined` when absent; `null` when present but malformed (the message fails closed). */
export function parseChatAttachments(raw: unknown): ChatAttachment[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS_PER_TURN) return null;
  const out: ChatAttachment[] = [];
  for (const item of raw) {
    const parsed = parseChatAttachment(item);
    if (!parsed || out.some(a => a.id === parsed.id)) return null;
    out.push(parsed);
  }
  return out;
}

function isAttachEntry(value: unknown): value is { id: string; seq: number } {
  return isRecord(value) && str(value.id) && num(value.seq);
}

function isHistoryMessage(value: unknown): value is HistoryMessage {
  return (
    isRecord(value) &&
    str(value.id) &&
    (value.role === "user" || value.role === "assistant") &&
    str(value.text) &&
    num(value.at)
  );
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "gate_list": return { type: "gate_list" };
    case "gate_decide": {
      const decision = parseGateDecision(raw.decision);
      return decision ? { type: "gate_decide", decision } : null;
    }
    case "gate_post": return str(raw.id) && /^[a-f0-9-]{36}$/.test(raw.id) ? { type: "gate_post", id: raw.id } : null;
    case "live_open":
    case "live_turn":
    case "live_intent":
    case "live_receipts": return parseLiveClientMessage(raw);
    case "chat": {
      const attachments = parseChatAttachments(raw.attachments);
      if (
        str(raw.id) &&
        str(raw.harness) &&
        str(raw.text) &&
        optStr(raw.hostId) && optStr(raw.profileId) &&
        optStr(raw.sessionId) &&
        optStr(raw.cwd) &&
        attachments !== null
      ) {
        return {
          type: "chat",
          id: raw.id,
          harness: raw.harness,
          text: raw.text,
          sessionId: raw.sessionId,
          hostId: raw.hostId,
          profileId: raw.profileId,
          cwd: raw.cwd,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        };
      }
      return null;
    }
    case "voice_begin":
      if (str(raw.id) && str(raw.harness) && str(raw.mime) && optStr(raw.hostId) && optStr(raw.profileId) && optStr(raw.sessionId) && optStr(raw.cwd)) {
        return {
          type: "voice_begin",
          id: raw.id,
          harness: raw.harness,
          mime: raw.mime,
          sessionId: raw.sessionId,
          hostId: raw.hostId,
          profileId: raw.profileId,
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
    case "history":
      if (str(raw.harness) && str(raw.sessionId) && raw.sessionId.length > 0 && optStr(raw.hostId) && optStr(raw.profileId) && optStr(raw.cwd)) {
        return { type: "history", harness: raw.harness, sessionId: raw.sessionId, cwd: raw.cwd, hostId: raw.hostId, profileId: raw.profileId };
      }
      return null;
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
  if (!optStr(value.profileId) || !optStr(value.hostId) || !optStr(value.source)) return false;
  if (value.lastActivityAt !== undefined && !num(value.lastActivityAt)) return false;
  if (value.openIn !== undefined && !str(value.openIn)) return false;
  if (value.messageCount !== undefined && !num(value.messageCount)) return false;
  return true;
}

export function parseHosts(raw: unknown): HostInfo[] | undefined {
  if (!Array.isArray(raw) || !raw.every(isHostInfo)) return undefined;
  return raw;
}

const BOT_CHANNEL_STATES = ["connected", "retrying", "disconnected", "configured"] as const;

function isBotChannel(value: unknown): value is BotChannel {
  return isRecord(value) && str(value.platform) && typeof value.state === "string" && BOT_CHANNEL_STATES.some(s => s === value.state);
}

export function isBotInfo(value: unknown): value is BotInfo {
  return (
    isRecord(value) &&
    str(value.id) &&
    str(value.name) &&
    str(value.runtime) &&
    isAgentStatus(value.status) &&
    Array.isArray(value.channels) &&
    value.channels.every(isBotChannel) &&
    optStr(value.agentId) &&
    optStr(value.detail)
  );
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
    value.agents.every(isAgentInfo) &&
    (value.bots === undefined || (Array.isArray(value.bots) && value.bots.every(isBotInfo)))
  );
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "live_opened":
    case "live_event":
    case "live_receipts":
    case "live_error": return parseLiveServerMessage(raw);
    case "gate_snapshot": return Array.isArray(raw.items) && raw.items.every(isGateItem) && typeof raw.dry_run === "boolean" ? { type: "gate_snapshot", items: raw.items, dry_run: raw.dry_run, owner_decisions: raw.owner_decisions === true } : null;
    case "gate_status": return str(raw.id) && str(raw.message) ? { type: "gate_status", id: raw.id, message: raw.message } : null;
    case "gate_error": return str(raw.message) ? { type: "gate_error", message: raw.message } : null;
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
      return str(raw.id) && num(raw.seq) && str(raw.sessionId) && optStr(raw.hostId) && optStr(raw.profileId) && optStr(raw.harnessId) && optStr(raw.transport)
        ? { type: "session", id: raw.id, seq: raw.seq, sessionId: raw.sessionId, hostId: raw.hostId, profileId: raw.profileId, harnessId: raw.harnessId, transport: raw.transport }
        : null;
    case "transcript":
      return str(raw.id) && num(raw.seq) && str(raw.text)
        ? { type: "transcript", id: raw.id, seq: raw.seq, text: raw.text }
        : null;
    case "delta":
      return str(raw.id) && num(raw.seq) && str(raw.text)
        ? { type: "delta", id: raw.id, seq: raw.seq, text: raw.text }
        : null;
    case "status": {
      if (!str(raw.id) || !num(raw.seq) || !str(raw.text)) return null;
      if (raw.handoff !== undefined) {
        const h = raw.handoff;
        if (!isRecord(h) || (h.state !== "queued" && h.state !== "sending") || !str(h.surface) || !str(h.host) || raw.acp !== undefined) return null;
        return { type: "status", id: raw.id, seq: raw.seq, text: raw.text, handoff: { state: h.state, surface: h.surface, host: h.host } };
      }
      if (raw.acp === undefined) return { type: "status", id: raw.id, seq: raw.seq, text: raw.text };
      if (!isRecord(raw.acp) || !str(raw.acp.sessionId) || !isRecord(raw.acp.update) || Array.isArray(raw.acp.update)) return null;
      return { type: "status", id: raw.id, seq: raw.seq, text: raw.text, acp: { sessionId: raw.acp.sessionId, update: raw.acp.update } };
    }
    case "done":
      return str(raw.id) && num(raw.seq) && num(raw.exitCode)
        ? { type: "done", id: raw.id, seq: raw.seq, exitCode: raw.exitCode }
        : null;
    case "error":
      return str(raw.id) && num(raw.seq) && str(raw.message)
        ? { type: "error", id: raw.id, seq: raw.seq, message: raw.message }
        : null;
    case "history":
      return str(raw.harness) && str(raw.sessionId) && optStr(raw.hostId) && optStr(raw.profileId) && Array.isArray(raw.messages) && raw.messages.every(isHistoryMessage)
        ? { type: "history", harness: raw.harness, sessionId: raw.sessionId, messages: raw.messages, hostId: raw.hostId, profileId: raw.profileId }
        : null;
    default:
      return null;
  }
}
