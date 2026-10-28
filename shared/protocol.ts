// Wire protocol between the phone app and the laptop bridge.
// One WebSocket; JSON text frames; every message has a `type` discriminant.
// Imported by both `bridge/` and `app/`, so it must stay dependency-free.

import { isGateItem, parseGateDecision, type GateItem, type GateDecision } from "./gate";
import { parsePermissionDecision, parsePermissionRequest, parsePermissionResolution, type PermissionDecision, type PermissionRequest, type PermissionResolution } from "./permission";
import { parseLiveClientMessage, parseLiveServerMessage, type LiveClientMessage, type LiveServerMessage } from "./live";
import { parseReplyPart, parseReplyParts, type ReplyPart } from "./reply-parts";
export type { ReplyPart } from "./reply-parts";
import { parseSummary, type SummaryInfo } from "./thinking-summary";
export const PROTOCOL_VERSION = 1;

export const NOTICE_TITLE_MAX = 80;
export const NOTICE_BODY_MAX = 600;
export interface NoticeInput { title: string; body: string; url?: string; class?: "critical" | "decision" | "report" | "digest"; not_before?: string }

function isNoticeTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !match[1] || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false;
  const day = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1];
}
export type NoticeMessage = NoticeInput & { type: "notice"; id: string };

/** Reports are additive v1 events, never approvals or turn events. */
export function parseNoticeInput(raw: unknown): NoticeInput | null {
  if (!isRecord(raw) || !str(raw.title) || !str(raw.body)) return null;
  if (!raw.title.trim() || raw.title.length > NOTICE_TITLE_MAX || !raw.body.trim() || raw.body.length > NOTICE_BODY_MAX) return null;
  if (raw.url !== undefined) {
    if (!str(raw.url) || raw.url.length > 512) return null;
    try { const url = new URL(raw.url); if (url.protocol !== "dash:" || !url.hostname || url.username || url.password) return null; }
    catch { return null; }
  }
  const cls = raw.class;
  if (cls !== undefined && cls !== "critical" && cls !== "decision" && cls !== "report" && cls !== "digest") return null;
  if (raw.not_before !== undefined && !isNoticeTime(raw.not_before)) return null;
  return { title: raw.title, body: raw.body, ...(str(raw.url) ? { url: raw.url } : {}),
    ...(cls !== undefined ? { class: cls } : {}), ...(isNoticeTime(raw.not_before) ? { not_before: raw.not_before } : {}) };
}

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

export const CHATS_FEATURE = "chats.v1";

export type ChatOrigin = "live" | "hermes" | "agentsview";

/** One chat summary row. Never carries message bodies. */
export interface ChatSummary {
  /** Stable, origin-independent identity: `${hostId}:${kind}:${sessionId}` (+ `:${profileId}` for hermes). */
  key: string;
  /** Harness/agent id as reported; may be non-catalog (opencode, chatgpt, …). */
  kind: string;
  /** Harness-native id (AgentsView "<agent>:" prefix stripped). */
  sessionId: string;
  /** Self host id, or `machine:<name>` for archive rows from other machines. */
  hostId: string;
  hostName: string;
  /** Hermes profile. */
  profileId?: string;
  /** Equals AgentInfo.id for this session (needed for ws history / adoption). */
  agentId?: string;
  /** ≤ 200 chars, single line, redacted. */
  title: string;
  cwd?: string;
  startedAt: number;
  /** Sort key. */
  lastActivityAt: number;
  messageCount: number;
  origin: ChatOrigin;
  /** Dash can send turns: isCatalogHarness(kind) && hostId === self. Else view-only. */
  chatable: boolean;
  running?: boolean;
  openIn?: string;
}

export interface ChatPage {
  /** Sorted lastActivityAt desc, key asc. */
  items: ChatSummary[];
  /** Opaque cursor; null = exhausted. */
  next: string | null;
  /** Index revision the page was cut from. */
  rev: number;
}

/** UTF-16 offsets into `snippet`. */
export interface SearchHighlight { start: number; end: number }
export interface ChatSearchHit {
  chat: ChatSummary;
  field: "title" | "cwd" | "message";
  /** "av:<rowid>" | "hz:<profile>:<id>". */
  messageId?: string;
  role?: "user" | "assistant";
  at?: number;
  /** ≤ 240 chars, redacted. */
  snippet: string;
  highlights: SearchHighlight[];
}
export interface ChatSearchPage {
  /** At most one hit per chat key per page; title/cwd hits first on page 1. */
  hits: ChatSearchHit[];
  next: string | null;
  /** True when the time budget ended the scan early. Fewer hits does not mean exhausted. */
  partial: boolean;
}

export interface HistoryPage {
  /** Chronological asc. */
  messages: HistoryMessage[];
  /** Cursor for the next OLDER page; null = start of chat. */
  before: string | null;
}

/** History text is cut to this many chars; `truncated` marks the cut. */
export const MESSAGE_TEXT_MAX = 16000;

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

/** Live local-host evidence, served separately from the ETag-hashed roster. */
export interface HostStats {
  hostId: string;
  sampledAt: number;
  cpuCount: number;
  /** Missing until two CPU counter readings exist; never a load-based estimate. */
  cpuPct?: number;
  memory?: { usedBytes: number; totalBytes: number };
  disk?: { path: string; usedBytes: number; totalBytes: number };
  load?: { one: number; five: number; fifteen: number };
  gpus?: { name: string; usagePct?: number; usedBytes?: number; totalBytes?: number; temperatureC?: number }[];
  temperatureC?: number;
  battery?: { percent: number; status: string; temperatureC?: number };
}

function statsNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function statsPercent(value: unknown): value is number { return statsNumber(value) && value <= 100; }
function statsBytes(value: unknown): boolean {
  return isRecord(value) && statsNumber(value.usedBytes) && statsNumber(value.totalBytes) && value.totalBytes > 0 && value.usedBytes <= value.totalBytes;
}
function isHostStats(value: unknown): value is HostStats {
  if (!isRecord(value) || !str(value.hostId) || !statsNumber(value.sampledAt) || !statsNumber(value.cpuCount) || !Number.isInteger(value.cpuCount) || value.cpuCount < 1) return false;
  if (value.cpuPct !== undefined && !statsPercent(value.cpuPct)) return false;
  if (value.memory !== undefined && !statsBytes(value.memory)) return false;
  if (value.disk !== undefined && (!statsBytes(value.disk) || !isRecord(value.disk) || !str(value.disk.path))) return false;
  if (value.load !== undefined && (!isRecord(value.load) || !statsNumber(value.load.one) || !statsNumber(value.load.five) || !statsNumber(value.load.fifteen))) return false;
  if (value.temperatureC !== undefined && !statsNumber(value.temperatureC)) return false;
  if (value.battery !== undefined && (!isRecord(value.battery) || !statsPercent(value.battery.percent) || !str(value.battery.status) || (value.battery.temperatureC !== undefined && !statsNumber(value.battery.temperatureC)))) return false;
  if (value.gpus !== undefined && (!Array.isArray(value.gpus) || !value.gpus.every((gpu: unknown) => isRecord(gpu) && str(gpu.name)
    && (gpu.usagePct === undefined || statsPercent(gpu.usagePct)) && (gpu.usedBytes === undefined || statsNumber(gpu.usedBytes))
    && (gpu.totalBytes === undefined || statsNumber(gpu.totalBytes)) && (gpu.temperatureC === undefined || statsNumber(gpu.temperatureC))))) return false;
  return true;
}
export function parseHostStats(value: unknown): HostStats | null { return isHostStats(value) ? value : null; }

/** A machine on the tailnet (this laptop, host-b/0, …). */
export interface HostInfo {
  id: string;
  /** Optional for compatibility with older bridges. */
  kind?: "computer" | "phone";
  /** Tailscale last-seen timestamp (ISO 8601). */
  lastSeen?: string;
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
  /** The owner's choice on an ACP permission request (shared/permission.ts). */
  | PermissionDecision
  /** Phone "forget everything": clear the bridge's notice replay ring. Old bridges ignore it. */
  | { type: "notices_clear" }
  | {
      type: "chat";
      /** Omitted by older clients: queue for the next turn. */
      mode?: "steer" | "queue";
      summariesEnabled?: boolean;
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
      summariesEnabled?: boolean;
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
  | { type: "tool_detail"; id: string; callId: string; messageId?: string; sessionId?: string; profileId?: string; hostId?: string }
  /**
   * Re-subscribe to turns that were in flight when the socket dropped.
   * `seq` is the last event sequence number the client has for that turn;
   * the bridge replays everything after it.
   */
  | { type: "attach"; turns: { id: string; seq: number }[] }
  /** Replay a live harness transcript into the open Chat. Unknown harness ids fail closed. */
  | { type: "history"; harness: string; sessionId: string; cwd?: string; hostId?: string; profileId?: string; limit?: number; requestId?: string };

/** One user or assistant turn from a harness session file. */
export interface HistoryMessage {
  parts?: ReplyPart[];
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Text was cut to MESSAGE_TEXT_MAX chars. Fetch the full text with GET /chats/message. */
  truncated?: boolean;
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
  | { type: "status"; id: string; seq: number; text: string; part?: ReplyPart; summary?: SummaryInfo; acp?: AcpStatus; handoff?: HandoffInfo; delivery?: "steered" | "queued" | "started"; deliveryAt?: number }
  | { type: "done"; id: string; seq: number; exitCode: number }
  | { type: "error"; id: string; seq: number; message: string };

export type ServerMessage =
  | NoticeMessage
  | GateServerMessage
  | LiveServerMessage
  | PermissionRequest
  | PermissionResolution
  | {
      type: "hello";
      version: number;
      host: string;
      cwd: string;
      harnesses: HarnessInfo[];
      /** Optional; old bridges omit this. */
      hosts?: HostInfo[];
      /** Optional capability flags, e.g. CHATS_FEATURE. Old bridges omit this. */
      features?: string[];
      /**
       * Optional. Host ids besides this computer (chat-index `machine:<name>`) whose recorded
       * Claude Code / Codex chats this bridge continues on that computer. Old bridges omit this.
       */
      routes?: string[];
    }
  /** Reply to `attach` for a turn the bridge no longer knows about. */
  | { type: "lost"; id: string }
  /** Live session transcript for `history`. Empty `messages` if the harness is unknown. */
  | { type: "history"; harness: string; sessionId: string; messages: HistoryMessage[]; hostId?: string; profileId?: string; requestId?: string; before?: string | null }
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

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isAttachEntry(value: unknown): value is { id: string; seq: number } {
  return isRecord(value) && str(value.id) && num(value.seq);
}

function isHistoryMessage(value: unknown): value is HistoryMessage {
  return (
    isRecord(value) &&
    str(value.id) &&
    (value.role === "user" || value.role === "assistant") &&
    str(value.text) &&
    num(value.at) && (value.parts === undefined || parseReplyParts(value.parts) !== undefined) &&
    (value.truncated === undefined || typeof value.truncated === "boolean")
  );
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "notices_clear": return { type: "notices_clear" };
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
    case "permission_decision": return parsePermissionDecision(raw);
    case "chat": {
      const attachments = parseChatAttachments(raw.attachments);
      if (raw.mode !== undefined && raw.mode !== "steer" && raw.mode !== "queue") return null;
      if (
        str(raw.id) &&
        str(raw.harness) &&
        str(raw.text) &&
        optStr(raw.hostId) && optStr(raw.profileId) &&
        optStr(raw.sessionId) &&
        optStr(raw.cwd) &&
        (raw.summariesEnabled === undefined || typeof raw.summariesEnabled === "boolean") &&
        attachments !== null
      ) {
        return {
          type: "chat",
          ...(raw.mode === "steer" || raw.mode === "queue" ? { mode: raw.mode } : {}),
          ...(typeof raw.summariesEnabled === "boolean" ? { summariesEnabled: raw.summariesEnabled } : {}),
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
      if ((raw.summariesEnabled === undefined || typeof raw.summariesEnabled === "boolean") && str(raw.id) && str(raw.harness) && str(raw.mime) && optStr(raw.hostId) && optStr(raw.profileId) && optStr(raw.sessionId) && optStr(raw.cwd)) {
        return {
          type: "voice_begin",
          ...(typeof raw.summariesEnabled === "boolean" ? { summariesEnabled: raw.summariesEnabled } : {}),
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
    case "tool_detail": return str(raw.id) && str(raw.callId) && optStr(raw.messageId) && optStr(raw.sessionId) && optStr(raw.profileId) && optStr(raw.hostId) ? { type: "tool_detail", id: raw.id, callId: raw.callId, ...(raw.messageId ? { messageId: raw.messageId } : {}), ...(raw.sessionId ? { sessionId: raw.sessionId } : {}), ...(raw.profileId ? { profileId: raw.profileId } : {}), ...(raw.hostId ? { hostId: raw.hostId } : {}) } : null;
    case "cancel":
      return str(raw.id) ? { type: "cancel", id: raw.id } : null;
    case "attach":
      return Array.isArray(raw.turns) && raw.turns.every(isAttachEntry)
        ? { type: "attach", turns: raw.turns }
        : null;
    case "history":
      if (raw.limit !== undefined && !(typeof raw.limit === "number" && Number.isInteger(raw.limit) && raw.limit >= 1 && raw.limit <= 400)) return null;
      if (raw.requestId !== undefined && !(str(raw.requestId) && REQUEST_ID.test(raw.requestId))) return null;
      if (str(raw.harness) && str(raw.sessionId) && raw.sessionId.length > 0 && optStr(raw.hostId) && optStr(raw.profileId) && optStr(raw.cwd)) {
        return {
          type: "history", harness: raw.harness, sessionId: raw.sessionId, cwd: raw.cwd, hostId: raw.hostId, profileId: raw.profileId,
          ...(typeof raw.limit === "number" ? { limit: raw.limit } : {}),
          ...(str(raw.requestId) ? { requestId: raw.requestId } : {}),
        };
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
    (value.kind === undefined || value.kind === "computer" || value.kind === "phone") &&
    (value.lastSeen === undefined || (str(value.lastSeen) && Number.isFinite(Date.parse(value.lastSeen)))) &&
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
    case "notice": {
      const notice = parseNoticeInput(raw);
      return notice && str(raw.id) && raw.id.length > 0 && raw.id.length <= 128 ? { type: "notice", id: raw.id, ...notice } : null;
    }
    case "live_opened":
    case "live_event":
    case "live_receipts":
    case "live_error": return parseLiveServerMessage(raw);
    case "permission_request": return parsePermissionRequest(raw);
    case "permission_resolved": return parsePermissionResolution(raw);
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
          features: Array.isArray(raw.features) && raw.features.length <= 32 && raw.features.every(str) ? raw.features : undefined,
          routes: Array.isArray(raw.routes) && raw.routes.length <= 32 && raw.routes.every(str) ? raw.routes : undefined,
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
      if (raw.delivery !== undefined) {
        if ((raw.deliveryAt !== undefined && !num(raw.deliveryAt)) || raw.part !== undefined || raw.summary !== undefined || raw.acp !== undefined || raw.handoff !== undefined) return null;
        if (raw.delivery === "steered" || raw.delivery === "queued" || raw.delivery === "started") return { type: "status", id: raw.id, seq: raw.seq, text: raw.text, delivery: raw.delivery, ...(num(raw.deliveryAt) ? { deliveryAt: raw.deliveryAt } : {}) };
        return null;
      }
      if (raw.part !== undefined) {
        const part = parseReplyPart(raw.part);
        return part && raw.summary === undefined && raw.acp === undefined && raw.handoff === undefined ? { type: "status", id: raw.id, seq: raw.seq, text: raw.text, part } : null;
      }
      if (raw.summary !== undefined) {
        const summary = parseSummary(raw.summary);
        return summary && raw.part === undefined && raw.acp === undefined && raw.handoff === undefined ? { type: "status", id: raw.id, seq: raw.seq, text: raw.text, summary } : null;
      }
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
      if (raw.requestId !== undefined && !(str(raw.requestId) && REQUEST_ID.test(raw.requestId))) return null;
      if (raw.before !== undefined && raw.before !== null && !str(raw.before)) return null;
      return str(raw.harness) && str(raw.sessionId) && optStr(raw.hostId) && optStr(raw.profileId) && Array.isArray(raw.messages) && raw.messages.every(isHistoryMessage)
        ? {
            type: "history", harness: raw.harness, sessionId: raw.sessionId, messages: raw.messages, hostId: raw.hostId, profileId: raw.profileId,
            ...(str(raw.requestId) ? { requestId: raw.requestId } : {}),
            ...(raw.before === null || str(raw.before) ? { before: raw.before } : {}),
          }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// chats.v1: paged chat index over authenticated HTTP (GET /chats, /chats/search,
// /chats/history, /chats/message). Parsers are shared by bridge validation and
// app response checks. Response parsers drop malformed items one at a time.
// ---------------------------------------------------------------------------

/** kind/host filter values and route ids. */
export const CHAT_NAME = /^[A-Za-z0-9:._-]{1,64}$/;
/** Longest cursor accepted (base64url chars). Search cursors carry up to 256 emitted-chat hashes. */
export const CURSOR_MAX_BYTES = 4096;
export type ChatQueryError = { error: "bad_request" | "bad_cursor"; field: string };
export interface ChatListQuery { limit: number; cursor?: string; kinds: string[]; hosts: string[]; chatable: boolean }
export interface ChatSearchQuery { q: string; limit: number; cursor?: string; kinds: string[]; hosts: string[]; in: "all" | "titles" }
export interface HistoryQuery { key?: string; kind?: string; sessionId?: string; host?: string; profile?: string; before?: string; limit: number }

/** The one key builder. App and bridge must both use it. Profile only distinguishes Hermes chats. */
export function chatKey(chat: { hostId: string; kind: string; sessionId: string; profileId?: string }): string {
  const base = `${chat.hostId}:${chat.kind}:${chat.sessionId}`;
  return chat.kind === "hermes" && chat.profileId ? `${base}:${chat.profileId}` : base;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return out;
}

function utf8Decode(bytes: number[]): string | null {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] ?? 0;
    const need = b < 0x80 ? 0 : b >= 0xf0 && b < 0xf8 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    if (need < 0) return null;
    let code = need === 0 ? b : b & (0x3f >> need);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      code = (code << 6) | (c & 63);
    }
    if (code > 0x10ffff) return null;
    out += String.fromCodePoint(code);
    i += need + 1;
  }
  return out;
}

/** base64url(JSON). Opaque to the app. */
export function encodeCursor(value: Record<string, unknown>): string {
  const bytes = utf8Encode(JSON.stringify(value));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += (B64[(n >> 18) & 63] ?? "") + (B64[(n >> 12) & 63] ?? "");
    if (b !== undefined) out += B64[(n >> 6) & 63] ?? "";
    if (c !== undefined) out += B64[n & 63] ?? "";
  }
  return out;
}

/** Null for oversize, non-base64url, non-canonical, non-JSON or non-object input. */
export function decodeCursor(text: string): Record<string, unknown> | null {
  if (text.length === 0 || text.length > CURSOR_MAX_BYTES || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) n = (n << 6) | (k < chunk.length ? B64.indexOf(chunk[k] ?? "") : 0);
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  const json = utf8Decode(bytes);
  if (json === null) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value) || Array.isArray(value)) return null;
    // One cursor has one spelling: reject stray low bits, overlong UTF-8 and foreign JSON layouts.
    if (encodeCursor(value) !== text) return null;
    return value;
  } catch {
    return null;
  }
}

function csv(params: URLSearchParams, name: string): string[] | ChatQueryError {
  const raw = params.get(name);
  if (raw === null || raw === "") return [];
  const items = raw.split(",");
  if (items.length > 16 || !items.every(item => CHAT_NAME.test(item))) return { error: "bad_request", field: name };
  return [...new Set(items)];
}

function limitParam(params: URLSearchParams, fallback: number, max: number): number | ChatQueryError {
  const raw = params.get("limit");
  if (raw === null || raw === "") return fallback;
  if (!/^-?\d{1,6}$/.test(raw)) return { error: "bad_request", field: "limit" };
  return Math.min(max, Math.max(1, Number(raw)));
}

function cursorParam(params: URLSearchParams, name: string): string | undefined | ChatQueryError {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  return decodeCursor(raw) ? raw : { error: "bad_cursor", field: name };
}

function isQueryError(value: unknown): value is ChatQueryError {
  return isRecord(value) && !Array.isArray(value) && typeof value.error === "string" && typeof value.field === "string";
}

export function parseChatListQuery(params: URLSearchParams): ChatListQuery | ChatQueryError {
  const limit = limitParam(params, 50, 100);
  if (isQueryError(limit)) return limit;
  const cursor = cursorParam(params, "cursor");
  if (isQueryError(cursor)) return cursor;
  const kinds = csv(params, "kind");
  if (isQueryError(kinds)) return kinds;
  const hosts = csv(params, "host");
  if (isQueryError(hosts)) return hosts;
  const chatable = params.get("chatable");
  if (chatable !== null && chatable !== "1" && chatable !== "0") return { error: "bad_request", field: "chatable" };
  return { limit, ...(cursor ? { cursor } : {}), kinds, hosts, chatable: chatable === "1" };
}

export function parseChatSearchQuery(params: URLSearchParams): ChatSearchQuery | ChatQueryError {
  const q = (params.get("q") ?? "").trim();
  if (q.length < 1 || q.length > 200 || q.split(/\s+/).length > 8) return { error: "bad_request", field: "q" };
  const limit = limitParam(params, 20, 50);
  if (isQueryError(limit)) return limit;
  const cursor = cursorParam(params, "cursor");
  if (isQueryError(cursor)) return cursor;
  const kinds = csv(params, "kind");
  if (isQueryError(kinds)) return kinds;
  const hosts = csv(params, "host");
  if (isQueryError(hosts)) return hosts;
  const scope = params.get("in") ?? "all";
  if (scope !== "all" && scope !== "titles") return { error: "bad_request", field: "in" };
  return { q, limit, ...(cursor ? { cursor } : {}), kinds, hosts, in: scope };
}

export function parseHistoryQuery(params: URLSearchParams): HistoryQuery | ChatQueryError {
  const limit = limitParam(params, 50, 200);
  if (isQueryError(limit)) return limit;
  const before = cursorParam(params, "before");
  if (isQueryError(before)) return before;
  const key = params.get("key");
  if (key !== null) {
    if (key.length < 1 || key.length > 512) return { error: "bad_request", field: "key" };
    return { key, ...(before ? { before } : {}), limit };
  }
  const kind = params.get("kind");
  if (kind === null) return { error: "bad_request", field: "key" };
  if (!CHAT_NAME.test(kind)) return { error: "bad_request", field: "kind" };
  const sessionId = params.get("sessionId");
  if (!sessionId || sessionId.length > 256) return { error: "bad_request", field: "sessionId" };
  const host = params.get("host");
  if (host !== null && !CHAT_NAME.test(host)) return { error: "bad_request", field: "host" };
  const profile = params.get("profile");
  if (profile !== null && !CHAT_NAME.test(profile)) return { error: "bad_request", field: "profile" };
  return { kind, sessionId, ...(host ? { host } : {}), ...(profile ? { profile } : {}), ...(before ? { before } : {}), limit };
}

const ORIGINS = ["live", "hermes", "agentsview"] as const;

export function parseChatSummary(value: unknown): ChatSummary | null {
  if (!isRecord(value)) return null;
  const v = value;
  if (!str(v.key) || !str(v.kind) || !str(v.sessionId) || !str(v.hostId) || !str(v.hostName) || !str(v.title)) return null;
  if (!num(v.startedAt) || !num(v.lastActivityAt) || !num(v.messageCount) || typeof v.chatable !== "boolean") return null;
  const origin = ORIGINS.find(o => o === v.origin);
  if (!origin || !optStr(v.profileId) || !optStr(v.agentId) || !optStr(v.cwd) || !optStr(v.openIn)) return null;
  if (v.running !== undefined && typeof v.running !== "boolean") return null;
  return {
    key: v.key, kind: v.kind, sessionId: v.sessionId, hostId: v.hostId, hostName: v.hostName,
    ...(str(v.profileId) ? { profileId: v.profileId } : {}), ...(str(v.agentId) ? { agentId: v.agentId } : {}),
    title: v.title, ...(str(v.cwd) ? { cwd: v.cwd } : {}), startedAt: v.startedAt, lastActivityAt: v.lastActivityAt,
    messageCount: v.messageCount, origin, chatable: v.chatable,
    ...(typeof v.running === "boolean" ? { running: v.running } : {}), ...(str(v.openIn) ? { openIn: v.openIn } : {}),
  };
}

function nextCursor(value: unknown): value is string | null { return value === null || str(value); }

export function parseChatPage(raw: unknown): ChatPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.items) || !nextCursor(raw.next) || !num(raw.rev)) return null;
  return { items: raw.items.flatMap(item => { const parsed = parseChatSummary(item); return parsed ? [parsed] : []; }), next: raw.next, rev: raw.rev };
}

function parseHit(value: unknown): ChatSearchHit | null {
  if (!isRecord(value)) return null;
  const chat = parseChatSummary(value.chat);
  if (!chat || (value.field !== "title" && value.field !== "cwd" && value.field !== "message") || !str(value.snippet) || !Array.isArray(value.highlights)) return null;
  if (!optStr(value.messageId) || (value.role !== undefined && value.role !== "user" && value.role !== "assistant") || (value.at !== undefined && !num(value.at))) return null;
  const snippet = value.snippet;
  const highlights: SearchHighlight[] = [];
  for (const h of value.highlights) {
    if (!isRecord(h) || !num(h.start) || !num(h.end) || !Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start < 0 || h.end <= h.start || h.end > snippet.length) return null;
    highlights.push({ start: h.start, end: h.end });
  }
  return {
    chat, field: value.field, ...(str(value.messageId) ? { messageId: value.messageId } : {}),
    ...(value.role === "user" || value.role === "assistant" ? { role: value.role } : {}),
    ...(num(value.at) ? { at: value.at } : {}), snippet, highlights,
  };
}

export function parseChatSearchPage(raw: unknown): ChatSearchPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.hits) || !nextCursor(raw.next) || typeof raw.partial !== "boolean") return null;
  return { hits: raw.hits.flatMap(hit => { const parsed = parseHit(hit); return parsed ? [parsed] : []; }), next: raw.next, partial: raw.partial };
}

export function parseHistoryPage(raw: unknown): HistoryPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.messages) || !nextCursor(raw.before)) return null;
  return { messages: raw.messages.filter(isHistoryMessage), before: raw.before };
}
