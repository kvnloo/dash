import { TurnPhase } from "./turn-phase";
import { acpToolPhase } from "./acp/phase";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readLocalCredential } from "./z0bridge-identity";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, HistoryMessage } from "../../shared/protocol";
import type { Sink } from "./harnesses";
import { hermesSessionAgentId } from "./hermes-sessions";
import { Z0BridgeClient, Z0BridgeError, type OnLive, type SessionSummary } from "./z0bridge/client";

/**
 * Hermes through z0bridge (kvnloo/z0bridge): listing, history and continuing sessions over the
 * host's z0bridge daemon, which speaks ACP to `hermes -p <profile> acp`.
 *
 * Fallback rule: every method returns `undefined` when z0bridge is not running or not configured,
 * and callers keep Dash's existing native-API/SessionDB path. Once z0bridge accepted (or refused)
 * a turn, its answer is final; a send is never retried on another transport.
 */

type Env = Record<string, string | undefined>;
const PER_PROFILE = 50;
const HEALTH_TTL_MS = 5_000;

function loopback(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) return undefined;
    return raw.replace(/\/+$/, "");
  } catch { return undefined; }
}

export function z0bridgeTokenPath(env: Env = process.env): string {
  return env.DASH_Z0BRIDGE_TOKEN_FILE || env.Z0BRIDGE_TOKEN_FILE || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "z0bridge", "token");
}

export function toAgent(session: SessionSummary): AgentInfo {
  return {
    id: hermesSessionAgentId(session.profile, session.id), name: session.title, kind: "hermes", status: "available",
    sessionId: session.id, profileId: session.profile, detail: `${session.profile} · ${session.source}`, source: session.source,
    cwd: session.cwd, lastActivityAt: session.lastActivityAt, messageCount: session.messageCount,
  };
}

export type Z0TurnOutcome = { exitCode: 0 } | { exitCode: 1; message: string } | { exitCode: "cancelled" };

export class Z0BridgeHermes {
  private healthAt = 0;
  private healthy = false;
  private cached?: Z0BridgeClient;
  constructor(private options: { env?: Env; fetch?: typeof fetch; client?: Z0BridgeClient } = {}) {}

  private get env(): Env { return this.options.env ?? process.env; }

  /** A configured client: z0bridge enabled, loopback URL, private (0600) token file. */
  private client(): Z0BridgeClient | undefined {
    if (this.options.client) return this.options.client;
    if (this.env.DASH_Z0BRIDGE === "0") return undefined;
    const base = loopback(this.env.DASH_Z0BRIDGE_URL || "http://127.0.0.1:4787");
    // Explicit enrollment selection never falls back to the owner credential.
    if (this.env.DASH_Z0BRIDGE_CREDENTIAL_FILE) {
      const enrollment = readLocalCredential(this.env.DASH_Z0BRIDGE_CREDENTIAL_FILE, ["hermes:sessions.read", "hermes:turns"]);
      if (!base || !enrollment) return undefined;
      return new Z0BridgeClient({ baseUrl: base, token: enrollment.credential, fetch: this.options.fetch, timeoutMs: 4_000 });
    }
    const path = z0bridgeTokenPath(this.env);
    if (!base || !existsSync(path)) return undefined;
    try {
      if (statSync(path).mode & 0o077) return undefined;
      const token = readFileSync(path, "utf8").trim();
      if (!token) return undefined;
      this.cached ??= new Z0BridgeClient({ baseUrl: base, token, fetch: this.options.fetch, timeoutMs: 4_000 });
      return this.cached;
    } catch { return undefined; }
  }

  /** The client when the daemon answers health (cached briefly), else undefined. */
  async ready(): Promise<Z0BridgeClient | undefined> {
    const client = this.client();
    if (!client) return undefined;
    if (Date.now() - this.healthAt < HEALTH_TTL_MS) return this.healthy ? client : undefined;
    try { this.healthy = (await client.health()).name === "z0bridge"; } catch { this.healthy = false; }
    this.healthAt = Date.now();
    return this.healthy ? client : undefined;
  }

  /** Up to 50 recent chats per profile, like `HermesSessions.list`, or undefined to fall back. */
  async list(): Promise<AgentInfo[] | undefined> {
    const client = await this.ready();
    if (!client) return undefined;
    try {
      const sessions: SessionSummary[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const result = await client.listSessions({ harness: "hermes", limit: 200, cursor });
        sessions.push(...result.sessions);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      const counts = new Map<string, number>();
      return sessions.filter(session => {
        const n = counts.get(session.profile) ?? 0;
        counts.set(session.profile, n + 1);
        return n < PER_PROFILE;
      }).map(toAgent);
    } catch { this.healthAt = 0; return undefined; }
  }

  async history(profile: string, sessionId: string): Promise<HistoryMessage[] | undefined> {
    const client = await this.ready();
    if (!client) return undefined;
    try {
      const { messages } = await client.messages("hermes", profile, sessionId, { limit: 200 });
      return messages;
    } catch (error) {
      if (error instanceof Z0BridgeError && error.status === 404) return [];
      this.healthAt = 0;
      return undefined;
    }
  }

  /**
   * Continue an existing session through `client`, streaming into `sink`. Live-elsewhere sessions
   * queue in Hermes's owner FIFO by default (`DASH_Z0BRIDGE_ON_LIVE=refuse` to refuse instead),
   * matching Dash's native API path, which also queues behind the live owner.
   */
  async continue(client: Z0BridgeClient, input: { profile: string; sessionId: string; text: string }, sink: Sink, signal: AbortSignal): Promise<Z0TurnOutcome> {
    const onLive: OnLive = this.env.DASH_Z0BRIDGE_ON_LIVE === "refuse" ? "refuse" : "queue";
    let started;
    try {
      started = await client.startTurn("hermes", input.profile, input.sessionId, { text: input.text, onLive });
    } catch (error) {
      return { exitCode: 1, message: error instanceof Z0BridgeError ? `z0bridge ${error.code}: ${error.message}` : "z0bridge did not accept the turn; nothing was retried." };
    }
    sink.session(input.sessionId);
    const cancel = () => { void client.cancelTurn(started.turnId).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    let phaseUpdate: Record<string, unknown> | undefined;
    const phase = new TurnPhase(text => sink.status(text, phaseUpdate ? { sessionId: input.sessionId, update: phaseUpdate } : undefined));
    let after = 0;
    try {
      // Reconnect the stream (never the turn) a few times if the SSE connection drops.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          for await (const event of client.events(started.turnId, { after })) {
            after = event.seq;
            switch (event.type) {
              case "delta": phase.text(); sink.delta(event.text); break;
              case "status": sink.status(event.text === "running" || event.text === "starting" ? "" : event.text); break;
              case "tool":
                phaseUpdate = { sessionUpdate: "tool_call_update", toolCallId: event.toolCallId, title: event.title, status: event.status, kind: event.kind };
                acpToolPhase(phase, phaseUpdate);
                phaseUpdate = undefined;
                break;
              case "done": return event.stopReason === "cancelled" ? { exitCode: "cancelled" } : { exitCode: 0 };
              case "error": return { exitCode: 1, message: event.message };
            }
          }
        } catch (error) {
          if (signal.aborted) return { exitCode: "cancelled" };
          if (attempt === 4) throw error;
          await Bun.sleep(500 * (attempt + 1));
        }
      }
      return { exitCode: 1, message: "z0bridge stream ended without a result; check history before resending." };
    } catch {
      return { exitCode: 1, message: "Lost the z0bridge stream; the turn may still be running. Check history before resending." };
    } finally { signal.removeEventListener("abort", cancel); }
  }
}

export const z0bridgeHermes = new Z0BridgeHermes();
