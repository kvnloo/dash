import { applyGateMessage } from "../store/approvals";
import { Platform, AppState as RNAppState, type AppStateStatus } from "react-native";
import { CHATS_FEATURE, parseServerMessage, type ChatAttachment, type ClientMessage } from "../../../shared/protocol";
import { agentNoticeInbox, noticeFailure } from "../store/notices";
import type { LiveIntent } from "../../../shared/live";
import { isDebugMode } from "../debug/mode";
import { applyLiveMessage, beginIntent, beginLiveTurn, beginOpen, beginReceipts, liveOf } from "../store/live";
import { fetchRosterIfChanged } from "../lib/roster";
import { executionToken, socketUrl } from "../lib/bridge-auth";
import { shouldRequestHistory } from "../lib/live-sessions";
import { headerSocket } from "../lib/native-socket";
import { reattachStreamingTurns, startSocketKeepalive } from "./socket-keepalive";
import type { Settings } from "../model";
import { configureChatIndex, setChatsFeatures } from "../store/chat-index-store";
import { configureHistoryPages } from "../store/history-pages";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyDeltas,
  applyLiveHistory,
  applyHistoryReply,
  migrateArchive,
  applyTranscript,
  applyTurnEvent,
  flushPendingSends,
  markTurnLost,
  locateTurn,
  rejectUnavailableTurn,
  setConnection,
  setLiveHistoryRequester,
  store,
  streamingTurns,
} from "../store/app";

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/** Newest history page size when the bridge pages history (chats.v1). */
const HISTORY_HEAD = 50;
const DELTA_FLUSH_MS = 32;
const CONNECT_TIMEOUT_MS = 8000;

export function wsUrl(settings: Settings): string {
  return socketUrl(settings);
}

class Bridge {
  private ws: WebSocket | null = null;
  private connectEpoch = 0;
  private settings: Settings | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private rosterTimer: ReturnType<typeof setInterval> | undefined;
  private stopKeepalive: (() => void) | undefined;
  private pending = new Map<string, { text: string; seq: number }>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private appState: AppStateStatus = RNAppState.currentState;
  private rosterEtag: string | undefined;
  /** chats.v1 bridge: history requests carry limit + requestId, replies carry `before`. */
  private chats = false;
  private historyRequests = new Map<string, string>();
  private historySeq = 0;
  /** Hermes roster messageCount last requested per conversation: re-request only when it moves. */
  private hermesCounts = new Map<string, number | undefined>();
  private migration: "idle" | "scheduled" = "idle";

  constructor() {
    RNAppState.addEventListener("change", (next) => {
      const wasBackground = this.appState !== "active";
      this.appState = next;
      // Coming back to the foreground: don't wait out the backoff.
      if (next === "active" && wasBackground && this.settings && !this.isOpen()) this.connectNow();
    });
  }

  /** Start (or restart) with new settings. */
  start(settings: Settings): void {
    this.settings = settings;
    if (isDebugMode()) {
      this.clearTimers();
      this.teardownSocket();
      const harnesses = store.get().connection.harnesses;
      const hosts = store.get().connection.hosts;
      setConnection({
        status: "online",
        host: "debug-mbp",
        cwd: settings.cwd ?? "~/workspace/dash",
        error: undefined,
        harnesses:
          harnesses.length > 0
            ? harnesses
            : [
                { id: "omp", name: "OMP", available: true },
                { id: "codex", name: "Codex", available: true },
                { id: "grok", name: "Grok", available: true },
                { id: "hermes", name: "Hermes", available: true },
                { id: "pi", name: "Pi", available: false },
                { id: "fx", name: "fx", available: false },
              ],
        hosts: hosts.length > 0 ? hosts : [],
      });
      return;
    }
    this.attempt = 0;
    this.teardownSocket();
    this.connectNow();
  }

  stop(): void {
    this.settings = null;
    this.clearTimers();
    this.teardownSocket();
    setConnection({ status: "idle", error: undefined });
  }

  /** User-initiated retry (tap on the offline pill). */
  retry(): void {
    if (!this.settings) return;
    this.attempt = 0;
    this.connectNow();
  }

  isOpen(): boolean {
    if (isDebugMode()) return true;
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(message: ClientMessage): boolean {
    if (isDebugMode()) return true;
    if (!this.isOpen() || !this.ws) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private async connectNow(): Promise<void> {
    if (!this.settings) return;
    this.clearTimers();
    this.teardownSocket();
    setConnection({ status: "connecting", error: undefined });
    const settings = this.settings;
    const epoch = ++this.connectEpoch;
    let ws: WebSocket;
    try {
      if (settings.identity && Platform.OS === "web") throw new Error("z0bridge WebSockets require the native app (header authentication).");
      const token = settings.identity ? await executionToken(settings) : undefined;
      if (this.settings !== settings || this.connectEpoch !== epoch) return;
      ws = token ? headerSocket(wsUrl(settings), token) : new WebSocket(wsUrl(settings));
    } catch (error) {
      if (this.settings === settings && this.connectEpoch === epoch) this.onClosed(error instanceof Error ? error.message : "Identity connection failed");
      return;
    }
    this.ws = ws;
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) {
        ws.close();
        this.onClosed("Timed out connecting");
      }
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.attempt = 0;
      this.stopKeepalive?.();
      this.stopKeepalive = startSocketKeepalive(ws);
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.onMessage(typeof event.data === "string" ? event.data : "");
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClosed(closeReason(event.code));
    };
  }

  private onClosed(reason: string): void {
    this.clearTimers();
    this.flushDeltas();
    if (!this.settings) return;
    setConnection({ status: "offline", error: reason });
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000;
    this.attempt += 1;
    // In the background the OS will likely kill the socket anyway; reconnect on foreground.
    if (this.appState === "active") this.retryTimer = setTimeout(() => this.connectNow(), delay);
  }

  private onMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const message = parseServerMessage(parsed);
    if (!message) return;
    switch (message.type) {
      case "notice": void agentNoticeInbox.receive(message).catch(noticeFailure); return;
      case "gate_snapshot":
      case "gate_status":
      case "gate_error": applyGateMessage(message); return;
      case "hello": {
        this.chats = message.features?.includes(CHATS_FEATURE) === true;
        this.rosterEtag = undefined;
        setChatsFeatures(message.features);
        setConnection({
          features: message.features ?? [],
          status: "online",
          host: message.host,
          cwd: message.cwd,
          harnesses: message.harnesses,
          hosts: message.hosts ?? [],
          error: undefined,
        });
        void this.refreshRoster();
        clearInterval(this.rosterTimer);
        this.rosterTimer = setInterval(() => { if (this.appState === "active") void this.refreshRoster(); }, 10000);
        if (this.ws) reattachStreamingTurns(this.ws, streamingTurns());
        this.send({ type: "gate_list" });
        flushPendingSends(sendChat);
        this.scheduleMigration();
        return;
      }
      case "lost":
        markTurnLost(message.id);
        return;
      case "delta": {
        const entry = this.pending.get(message.id);
        if (entry) {
          entry.text += message.text;
          entry.seq = message.seq;
        } else this.pending.set(message.id, { text: message.text, seq: message.seq });
        this.flushTimer ??= setTimeout(() => this.flushDeltas(), DELTA_FLUSH_MS);
        return;
      }
      case "transcript":
        this.flushDeltas();
        applyTranscript(message.id, message.text);
        return;
      case "session":
      case "status":
      case "done":
      case "error":
        // Keep ordering: text before the event that follows it.
        this.flushDeltas();
        applyTurnEvent(message);
        if (message.type === "done" || message.type === "error") flushPendingSends(sendChat);
        return;
      case "history": {
        const conversationId = message.requestId ? this.historyRequests.get(message.requestId) : undefined;
        if (message.requestId) this.historyRequests.delete(message.requestId);
        if (conversationId) {
          applyHistoryReply(conversationId, message.messages, message.before);
          return;
        }
        applyLiveHistory(message.harness, message.sessionId, message.messages, message.hostId, message.profileId);
        return;
      }
      case "live_opened":
      case "live_event":
      case "live_receipts":
      case "live_error":
        applyLiveMessage(message);
        return;
      default: {
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }

  private async refreshRoster(): Promise<void> {
    const settings = this.settings;
    if (!settings || !this.isOpen()) return;
    const fetched = await fetchRosterIfChanged(settings, this.rosterEtag);
    if (!fetched || this.settings !== settings || !this.isOpen()) return;
    // 304: nothing re-renders and nothing reconciles.
    if (fetched !== "unchanged") {
      this.rosterEtag = fetched.etag;
      setConnection({ hosts: fetched.hosts });
    }
    const current = store.get().conversations.find(c => c.id === store.get().activeId);
    if (!current?.sessionId || !shouldRequestHistory(current)) return;
    // Hermes: re-fetch only when the host's message count for this session moved.
    if (current.harness === "hermes" && current.messages.length > 0 && this.hermesCounts.has(current.id) && this.hermesCounts.get(current.id) === current.messageCount) return;
    this.requestHistory({ conversationId: current.id, harness: current.harness, sessionId: current.sessionId, hostId: current.targetHostId, profileId: current.profileId });
  }

  /** One ws history request. chats.v1 pages it and matches the reply by requestId. */
  requestHistory(input: { conversationId: string; harness: string; sessionId: string; cwd?: string; hostId?: string; profileId?: string }): void {
    const conversation = store.get().conversations.find(c => c.id === input.conversationId);
    if (input.harness === "hermes") this.hermesCounts.set(input.conversationId, conversation?.messageCount);
    if (!this.chats) {
      this.send({ type: "history", harness: input.harness, sessionId: input.sessionId, cwd: input.cwd, hostId: input.hostId, profileId: input.profileId });
      return;
    }
    const requestId = `h${(++this.historySeq).toString(36)}`;
    this.historyRequests.set(requestId, input.conversationId);
    if (this.historyRequests.size > 64) {
      const oldest = this.historyRequests.keys().next();
      if (!oldest.done) this.historyRequests.delete(oldest.value);
    }
    this.send({ type: "history", harness: input.harness, sessionId: input.sessionId, cwd: input.cwd, hostId: input.hostId, profileId: input.profileId, limit: HISTORY_HEAD, requestId });
  }

  /** chats.v1 only, once, after first paint: prune adopted archive rows the paged list replaces. */
  private scheduleMigration(): void {
    if (!this.chats || this.migration !== "idle") return;
    this.migration = "scheduled";
    const { InteractionManager }: typeof import("react-native") = require("react-native");
    InteractionManager.runAfterInteractions(() => {
      void migrateArchive({ legacy: false, pause: () => new Promise(resolve => setTimeout(resolve, 0)) }).catch(() => undefined);
    });
  }

  private flushDeltas(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    applyDeltas(batch);
  }

  private clearTimers(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.rosterTimer);
    this.stopKeepalive?.();
    this.stopKeepalive = undefined;
    this.rosterTimer = undefined;
    this.retryTimer = undefined;
    this.connectTimer = undefined;
  }

  private teardownSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    }
  }
}

function closeReason(code: number): string {
  switch (code) {
    case 1000:
      return "Connection closed";
    case 1006:
      return "Can't reach the bridge";
    case 1008:
    case 4001:
      return "Bridge rejected the token";
    default:
      return `Disconnected (${code})`;
  }
}

export const bridge = new Bridge();

setLiveHistoryRequester((input) => {
  bridge.requestHistory(input);
});

configureChatIndex({ settings: () => store.get().settings, storage: AsyncStorage });
configureHistoryPages({ settings: () => store.get().settings });

function targetForTurn(turnId: string): { hostId?: string; profileId?: string } {
  const where = locateTurn(turnId);
  const conversation = store.get().conversations.find(c => c.id === where?.conversationId);
  return { hostId: conversation?.targetHostId, profileId: conversation?.profileId };
}

/** Send one chat turn for the active conversation. Returns false if offline. */
export function sendChat(input: {
  mode?: "steer" | "queue";
  turnId: string;
  harness: string;
  text: string;
  sessionId?: string;
  cwd?: string;
  attachments?: ChatAttachment[];
}): boolean {
  if (rejectUnavailableTurn(input.turnId)) return false;
  const cwd = input.cwd ?? store.get().settings?.cwd;
  return bridge.send({
    type: "chat",
    mode: input.mode,
    summariesEnabled: store.get().conversations.find(c => c.messages.some(m => m.role === "assistant" && m.turnId === input.turnId))?.summariesEnabled === true,
    id: input.turnId,
    ...targetForTurn(input.turnId),
    harness: input.harness,
    text: input.text,
    sessionId: input.sessionId,
    cwd,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  });
}

/** Open a spoken turn; the utterance follows as `sendVoiceChunk` calls. */
export function sendVoiceBegin(input: {
  turnId: string;
  harness: string;
  mime: string;
  sessionId?: string;
  cwd?: string;
}): boolean {
  if (rejectUnavailableTurn(input.turnId)) return false;
  const cwd = input.cwd ?? store.get().settings?.cwd;
  const sent = bridge.send({
    type: "voice_begin",
    summariesEnabled: store.get().conversations.find(c => c.messages.some(m => m.role === "assistant" && m.turnId === input.turnId))?.summariesEnabled === true,
    id: input.turnId,
    ...targetForTurn(input.turnId),
    harness: input.harness,
    mime: input.mime,
    sessionId: input.sessionId,
    cwd,
  });
  if (!sent) applyTurnEvent({ type: "error", id: input.turnId, seq: 1, message: "Not connected to your computer." });
  return sent;
}

export function sendVoiceChunk(turnId: string, data: string): boolean {
  return bridge.send({ type: "voice_chunk", id: turnId, data });
}

/** End of utterance: the bridge transcribes and runs the turn. */
export function sendVoiceCommit(turnId: string): boolean {
  return bridge.send({ type: "voice_commit", id: turnId });
}

/** Live surface (fast lane of a Hermes chat): open the worker for this conversation. */
export function openLiveSurface(conversationId: string, target: { profileId?: string; sessionId?: string }): boolean {
  const id = beginOpen(conversationId);
  const ok = bridge.send({ type: "live_open", id, ...(target.profileId ? { profileId: target.profileId } : {}), ...(target.sessionId ? { sessionId: target.sessionId } : {}) });
  if (!ok) applyLiveMessage({ type: "live_error", id, message: "Not connected to the bridge." });
  return ok;
}

export function sendLiveTurn(conversationId: string, text: string): boolean {
  const live = liveOf(conversationId);
  if (!live.workerId || !live.profileId) return false;
  const id = beginLiveTurn(conversationId, text, live.askHermes);
  const ok = bridge.send({ type: "live_turn", id, workerId: live.workerId, profileId: live.profileId, text, ...(live.askHermes ? { askHermes: true } : {}) });
  if (!ok) applyLiveMessage({ type: "live_error", id, message: "Not connected to the bridge." });
  return ok;
}

/** The owner's tap on an fx0 control or a native fast control: recorded in Hermes, then the worker reacts. */
export function sendLiveIntent(conversationId: string, intent: LiveIntent): boolean {
  const live = liveOf(conversationId);
  if (!live.workerId || !live.profileId) return false;
  const id = beginIntent(conversationId, intent);
  const ok = bridge.send({ type: "live_intent", id, workerId: live.workerId, profileId: live.profileId, intent, continue: true });
  if (!ok) applyLiveMessage({ type: "live_error", id, message: "Not connected to the bridge." });
  return ok;
}

export function refreshLiveReceipts(conversationId: string): boolean {
  const live = liveOf(conversationId);
  if (!live.workerId || !live.profileId) return false;
  return bridge.send({ type: "live_receipts", id: beginReceipts(conversationId), workerId: live.workerId, profileId: live.profileId });
}
