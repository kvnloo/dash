import { applyGateMessage } from "../store/approvals";
import { createPermissionsStore } from "../store/permissions";
import { createReconnectLifecycle } from "../lib/reconnect-lifecycle";
import { reconnectStore } from "../store/reconnect";
import { Platform, AppState as RNAppState, type AppStateStatus } from "react-native";
import { CHATS_FEATURE, parseServerMessage, type ChatAttachment, type ClientMessage } from "../../../shared/protocol";
import { agentNoticeInbox, noticeFailure } from "../store/notices";
import type { LiveIntent } from "../../../shared/live";
import { isDebugMode } from "../debug/mode";
import { applyLiveMessage, beginIntent, beginLiveTurn, beginOpen, beginReceipts, liveOf } from "../store/live";
import { fetchRosterIfChanged } from "../lib/roster";
import { executionToken, socketUrl } from "../lib/bridge-auth";
import { visibleHarnesses } from "../lib/hidden-harnesses";
import { activate, endpointsOf, pickEndpoint, probeBridge } from "../lib/bridge-failover";
import { shouldRequestHistory } from "../lib/live-sessions";
import { headerSocket } from "../lib/native-socket";
import { isPongFrame, reattachStreamingTurns, startSocketKeepalive } from "./socket-keepalive";
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
  saveSettings,
  setConnection,
  setLiveHistoryRequester,
  store,
  streamingTurns,
} from "../store/app";

import { deliveryConnected, deliveryDisconnected, deliveryOutbox, enqueueDelivery, receiveDelivery } from "./delivery";
/** Newest history page size when the bridge pages history (chats.v1). */
const HISTORY_HEAD = 50;
const DELTA_FLUSH_MS = 32;

export function wsUrl(settings: Settings): string {
  return socketUrl(settings);
}

class Bridge {
  private ws: WebSocket | null = null;
  private connectEpoch = 0;
  private settings: Settings | null = null;
  private rosterTimer: ReturnType<typeof setInterval> | undefined;
  /** One owner for hello deadlines, bounded retry timing, foreground and stale generations. */
  private reconnect = createReconnectLifecycle({
    now: () => Date.now(),
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  }, {
    connect: generation => { void this.connectNow(generation); },
    abort: () => {
      // Also invalidate an in-flight executionToken() resolution, not just an open socket.
      this.connectEpoch += 1;
      this.clearTimers();
      this.flushDeltas();
      this.teardownSocket();
    },
    publish: snapshot => {
      reconnectStore.set(snapshot);
      // start() passes through "waiting" with no reason before the first dial. That is not a failure:
      // publishing offline there makes connectSettings() reject a pairing that has not been tried yet.
      if ((snapshot.phase === "waiting" || snapshot.phase === "paused" || snapshot.phase === "blocked") && snapshot.reason !== undefined) {
        setConnection({ status: "offline", error: snapshot.reason });
      }
    },
  });
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
  /** May a failed connect move to another paired bridge? Off while pairing/editing until it connects once. */
  private failover = true;
  private probing = false;
  /** Liveness of the open socket: last inbound frame, and whether this bridge answers pings. */
  private lastInboundAt = 0;
  private pongSeen = false;

  constructor() {
    RNAppState.addEventListener("change", (next) => {
      const wasBackground = this.appState !== "active";
      this.appState = next;
      if (next !== "active") {
        this.reconnect.background();
      } else if (wasBackground && this.settings) {
        // A stale half-open socket must also be retired on foreground.
        if (!this.isOpen() && this.reconnect.snapshot().phase === "online") this.reconnect.start();
        else this.reconnect.foreground();
        if (this.isOpen()) void this.returnToPrimary();
      }
    });
  }

  /**
   * Start (or restart) with new settings. `failover: false` pins the attempt to this
   * bridge (pairing or editing must report that bridge's own failure) until it connects once.
   */
  start(settings: Settings, options?: { failover?: boolean }): void {
    this.settings = settings;
    this.failover = options?.failover ?? true;
    if (isDebugMode()) {
      this.reconnect.stop();
      this.clearTimers();
      this.teardownSocket();
      const harnesses = store.get().connection.harnesses;
      const hosts = store.get().connection.hosts;
      setConnection({
        status: "online",
        host: "debug-host-a",
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
    // Retire the previous connection, reset failures and immediately dial this pairing.
    this.connectEpoch += 1;
    this.reconnect.start(this.appState !== "background" && this.appState !== "inactive");
  }

  stop(): void {
    this.settings = null;
    this.reconnect.stop();
    this.connectEpoch += 1;
    this.clearTimers();
    this.teardownSocket();
    setConnection({ status: "idle", error: undefined });
  }

  /** User-initiated retry (both the existing ConnectionPill and ReconnectNotice). */
  retry(): void {
    if (!this.settings) return;
    this.reconnect.retry();
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

  private async connectNow(generation: number): Promise<void> {
    if (!this.settings || this.reconnect.snapshot().generation !== generation) return;
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
      if (this.settings === settings && this.connectEpoch === epoch) this.onClosed(error instanceof Error ? error.message : "Identity connection failed", generation);
      return;
    }
    this.ws = ws;
    // The lifecycle watchdog covers both WebSocket OPEN and authenticated hello.
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnect.socketOpen(generation);
      // Connected once: from now on a lost connection may move to another paired bridge.
      this.failover = true;
      this.lastInboundAt = Date.now();
      this.pongSeen = false;
      this.stopKeepalive?.();
      this.stopKeepalive = startSocketKeepalive(ws, undefined, {
        lastInboundAt: () => this.lastInboundAt,
        pongSeen: () => this.pongSeen,
        onDead: () => {
          if (this.ws !== ws) return;
          // Half-open after a network switch: no onclose will come, so close and move on now.
          this.ws = null;
          try { ws.close(); } catch { /* already closing */ }
          this.onClosed("Bridge stopped answering", generation);
        },
      });
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      const raw = typeof event.data === "string" ? event.data : "";
      this.lastInboundAt = Date.now();
      if (isPongFrame(raw)) { this.pongSeen = true; return; }
      this.onMessage(raw, generation);
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClosed(closeReason(event.code), generation, event.code !== 1008 && event.code !== 4001);
    };
  }

  private onClosed(reason: string, generation: number, retryable = true): void {
    this.clearTimers();
    this.flushDeltas();
    if (!this.settings || this.reconnect.snapshot().generation !== generation) return;
    deliveryDisconnected();
    setConnection({ status: "offline", error: reason });
    this.reconnect.closed(generation, reason, retryable);
    // Failover is an alternative endpoint selection, never a second retry timer.
    // If probing outlasts the lifecycle retry, the epoch guard discards its stale result.
    if (retryable && this.failover && !this.probing && this.appState === "active" &&
        endpointsOf(this.settings).length > 1) {
      void this.failOver(this.settings, this.connectEpoch);
    }
  }

  /** Health-probe the paired bridges in order and move to the first one that answers. */
  private async failOver(settings: Settings, epoch: number): Promise<void> {
    this.probing = true;
    let pick: Awaited<ReturnType<typeof pickEndpoint>>;
    try {
      pick = await pickEndpoint(settings, address => probeBridge(address), settings.address);
    } finally {
      this.probing = false;
    }
    if (this.settings !== settings || this.connectEpoch !== epoch) return;
    if (pick && pick.address !== settings.address) {
      console.warn(`[dash.failover] ${settings.address} -> ${pick.address}`);
      const next = activate(settings, pick);
      this.settings = next;
      saveSettings(next);
      this.reconnect.retry();
    }
    // No healthy alternative: the lifecycle's bounded retry remains scheduled.
  }

  /** On a fallback bridge and back in the foreground: return to the primary when it answers and nothing streams. */
  private async returnToPrimary(): Promise<void> {
    const settings = this.settings;
    if (!settings || this.probing || !this.isOpen()) return;
    const primary = endpointsOf(settings)[0];
    if (!primary || primary.address === settings.address || streamingTurns().length > 0) return;
    const epoch = this.connectEpoch;
    if (!(await probeBridge(primary.address))) return;
    if (this.settings !== settings || this.connectEpoch !== epoch || streamingTurns().length > 0) return;
    console.warn(`[dash.failover] back to primary ${primary.address}`);
    const next = activate(settings, primary);
    this.settings = next;
    saveSettings(next);
    this.reconnect.start();
  }

  private onMessage(raw: string, generation: number): void {
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
      case "permission_request": {
        const where = locateTurn(message.turnId);
        if (where) permissionRequests.receiveRequest(where.conversationId, message);
        return;
      }
      case "permission_resolved": {
        const record = Object.values(permissionRequests.state.get().records)
          .find(item => item.turnId === message.turnId && item.requestId === message.requestId);
        if (record) permissionRequests.receiveResolution(record.conversationId, record.sessionId, message);
        return;
      }
      case "delivery_receipt": void receiveDelivery(message); return;
      case "hello": {
        // A socket is never considered connected until the bridge's authenticated hello.
        this.reconnect.authenticatedHello(generation);
        this.chats = message.features?.includes(CHATS_FEATURE) === true;
        this.rosterEtag = undefined;
        setChatsFeatures(message.features);
        setConnection({
          features: message.features ?? [],
          routes: message.routes ?? [],
          status: "online",
          host: message.host,
          cwd: message.cwd,
          harnesses: visibleHarnesses(message.harnesses),
          hosts: message.hosts ?? [],
          error: undefined,
        });
        void this.refreshRoster();
        clearInterval(this.rosterTimer);
        this.rosterTimer = setInterval(() => { if (this.appState === "active") void this.refreshRoster(); }, 10000);
        const socket = this.ws;
        void deliveryOutbox.hydrate().then(() => {
          if (socket && this.ws === socket) reattachStreamingTurns(socket, streamingTurns().filter(turn => {
            const record = deliveryOutbox.get().find(item => item.turnId === turn.id);
            return !record || record.stage === "acked-by-bridge" || record.stage === "started";
          }));
        });
        this.send({ type: "gate_list" });
        deliveryConnected(message => this.send(message), message.capabilities?.deliveryReceipts === true);
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
    clearInterval(this.rosterTimer);
    this.stopKeepalive?.();
    this.stopKeepalive = undefined;
    this.rosterTimer = undefined;
  }

  private teardownSocket(): void {
    deliveryDisconnected();
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

/** ACP permission requests (PermissionCard). The bridge's permission_resolved is the only grant. */
export const permissionRequests = createPermissionsStore({
  sendDecision: (_scope, decision) => {
    if (!bridge.send(decision)) throw new Error("Bridge offline");
  },
});

setLiveHistoryRequester((input) => {
  bridge.requestHistory(input);
});

configureChatIndex({ settings: () => store.get().settings, storage: AsyncStorage });
configureHistoryPages({ settings: () => store.get().settings, conversation: id => store.get().conversations.find(c => c.id === id) });

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
  void enqueueDelivery(input).catch(console.warn);
  return true;
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
