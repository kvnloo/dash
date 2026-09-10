import { AppState as RNAppState, type AppStateStatus } from "react-native";
import { parseServerMessage, type ClientMessage } from "../../../shared/protocol";
import { isDebugMode } from "../debug/mode";
import { fetchRoster } from "../lib/roster";
import type { Settings } from "../model";
import {
  applyDeltas,
  applyTranscript,
  applyTurnEvent,
  markTurnLost,
  setConnection,
  store,
  streamingTurns,
} from "../store/app";

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const DELTA_FLUSH_MS = 32;
const CONNECT_TIMEOUT_MS = 8000;

export function wsUrl(settings: Settings): string {
  return `ws://${settings.address}/ws?token=${encodeURIComponent(settings.token.trim())}`;
}

class Bridge {
  private ws: WebSocket | null = null;
  private settings: Settings | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<string, { text: string; seq: number }>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private appState: AppStateStatus = RNAppState.currentState;

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

  private connectNow(): void {
    if (!this.settings) return;
    this.clearTimers();
    this.teardownSocket();
    setConnection({ status: "connecting", error: undefined });
    const ws = new WebSocket(wsUrl(this.settings));
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
      case "hello": {
        setConnection({
          status: "online",
          host: message.host,
          cwd: message.cwd,
          harnesses: message.harnesses,
          hosts: message.hosts ?? [],
          error: undefined,
        });
        if (this.settings) {
          void fetchRoster(this.settings).then((hosts) => {
            if (hosts) setConnection({ hosts });
          });
        }
        const turns = streamingTurns();
        if (turns.length) this.send({ type: "attach", turns });
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
        return;
      default: {
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
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

/** Send one chat turn for the active conversation. Returns false if offline. */
export function sendChat(input: {
  turnId: string;
  harness: string;
  text: string;
  sessionId?: string;
  cwd?: string;
}): boolean {
  const cwd = input.cwd ?? store.get().settings?.cwd;
  return bridge.send({
    type: "chat",
    id: input.turnId,
    harness: input.harness,
    text: input.text,
    sessionId: input.sessionId,
    cwd,
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
  const cwd = input.cwd ?? store.get().settings?.cwd;
  return bridge.send({
    type: "voice_begin",
    id: input.turnId,
    harness: input.harness,
    mime: input.mime,
    sessionId: input.sessionId,
    cwd,
  });
}

export function sendVoiceChunk(turnId: string, data: string): boolean {
  return bridge.send({ type: "voice_chunk", id: turnId, data });
}

/** End of utterance: the bridge transcribes and runs the turn. */
export function sendVoiceCommit(turnId: string): boolean {
  return bridge.send({ type: "voice_commit", id: turnId });
}
