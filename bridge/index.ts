// Dash bridge: a WebSocket server on your tailnet that runs agent CLIs on this
// machine and streams their output to the phone.
//
//   bun bridge/index.ts
//
// Env: DASH_PORT (4747), DASH_HOST (detected Tailscale IPv4 only), DASH_CWD (launch dir).
//
// Turns outlive sockets. A phone that locks its screen drops the WebSocket; on
// reconnect it sends `attach` with the last seq it saw and the bridge replays
// the rest. Finished turns are kept for RETAIN_MS so late reattaches still work.

import { GateService } from "./src/gate/service";
import { GateStore } from "./src/gate/store";
import type { GateServerMessage } from "../shared/protocol";
import { statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type HarnessInfo,
  type HostInfo,
  type AcpStatus,
  type ServerMessage,
  type TurnEvent,
} from "../shared/protocol";
import { claimSession, currentOrCreateSession, startBoundSession } from "./pair";
import { isTailnetIPv4, loadBridgeSecrets, resolveBridgeHost } from "./src/bridge-security";
import { BridgeAuth, configuredIdentity, type BridgePrincipal } from "./src/z0bridge-identity";
import { createPairingHttpHandler } from "./src/pairing-http";
import { playPairCode } from "./pair-audio";
import { decodePairAudio } from "./pair-decode";
import { collectRoster, readLiveTranscript, SelfHost } from "./src/roster";
import { runHermesSession } from "./src/hermes-session";
import { streamHermesSession } from "./src/hermes-stream";
import { liveArgv, sendIntoLiveSession } from "./src/hermes-live";
import { sessionPhaseHttp } from "./src/hermes-phase";
import { hermesSessions, hermesSessionAgentId } from "./src/hermes-sessions";
import { awaitHandoff, chooseHermesRoute, claimContinuation, HandoffAborted, handoffText, liveText, planContinuation, type HandoffState } from "./src/hermes-continue";
import type { LiveOwner } from "./src/hermes-owner";
import { z0bridgeHermes } from "./src/z0bridge-hermes";
import { HARNESSES, type Harness, type Sink, type TurnInput } from "./src/harnesses";
import { acpCommand, AcpSupervisor, type AcpHandle } from "./src/acp/supervisor";
import {
  CANCELLED_EXIT_CODE,
  TIMEOUT_EXIT_CODE,
  attachSocket,
  detachSocket,
  pruneStaleUtterances,
  nonZeroExitMessage,
  replayAfter,
  timeoutMessage,
  turnTimeoutMs,
  waitForExitOrTimeout,
} from "./src/turn-safety";
import { speechAvailable, transcribe, warmup } from "./speech";
import { AttachmentError, AttachmentStore, promptWithAttachments, type StoredAttachment } from "./src/attachments";
import { createFilesHttpHandler } from "./src/files-http";
import { createSuggestionsHttpHandler } from "./src/suggestions-http";
import { LiveSurface } from "./src/live-surface";
import { createSupervisionHttpHandler } from "./src/supervision-http";
import { bunRun, defaultShareDirs, shareRoots } from "./src/share";

// ---------------------------------------------------------------------------
// Turns: one spawned process, a replayable event log, and a set of listeners
// ---------------------------------------------------------------------------

type Socket = Bun.ServerWebSocket<SocketData>;

interface SocketData {
  principal: BridgePrincipal;
  stopIdentityWatch?: () => void;
  /** Turn ids this socket is subscribed to. */
  turns: Set<string>;
  gateSend?: (message: GateServerMessage) => void;
}

/** Batches text deltas so a fast model doesn't turn into hundreds of tiny frames per second. */
const FLUSH_MS = 40;
const STDERR_TAIL = 2000;
/** How long a finished turn stays replayable. */
const RETAIN_MS = 10 * 60 * 1000;
const MAX_RETAINED = 50;
const acpSupervisor = new AcpSupervisor();

class Turn implements Sink {
  readonly events: TurnEvent[] = [];
  readonly listeners = new Set<Socket>();
  finished = false;

  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private abort: AbortController | null = null;
  private acp: AcpHandle | null = null;
  /** Last two characters of text sent so far; used to separate prose around tool calls. */
  private textTail = "";
  private breakPending = false;

  constructor(
    readonly id: string,
    readonly harness: Harness,
  ) {}

  /** Host profile that owns this Hermes turn's session, once known. */
  private hermesProfile?: string;
  private hermesTransport?: "api" | "acp" | "z0bridge" | "gateway";

  start(input: TurnInput): void {
    // A spoken turn is transcribed before it starts, so a cancel can arrive
    // while there is no process to kill yet.
    if (this.cancelled || this.finished) return;
    if (this.harness.id === "hermes" && input.sessionId) {
      this.continueHermes(input);
      return;
    }
    if (process.env.DASH_ENABLE_LEGACY_CLI !== "1") {
      const command = acpCommand(this.harness.id);
      if (!command) {
        this.endWithout(`${this.harness.name} ACP unavailable. Install its maintained ACP adapter on the host.`);
        return;
      }
      if (this.harness.id === "hermes") {
        // A new Hermes chat lands in the bridge's own HERMES_HOME profile. Name it so the
        // phone keeps one conversation when the roster reports that session.
        this.hermesProfile = hermesSessions.profileForHome(process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes"));
        this.hermesTransport = "acp";
      }
      this.runAcp(command, input);
      return;
    }
    if (this.harness.id === "hermes") {
      this.startHermes(input);
      return;
    }
    this.spawnCli(input);
  }

  private runAcp(command: string[], input: TurnInput, env?: Record<string, string>, release?: () => void): void {
    try {
      this.acp = acpSupervisor.start({ id: this.id, command, input, sink: this, env });
      void this.acp.done.then(
        () => { release?.(); this.finish(0); },
        error => {
          release?.();
          if (this.cancelled) this.finish(CANCELLED_EXIT_CODE);
          else { this.error(error instanceof Error ? error.message : "ACP turn failed"); this.finish(1); }
        },
      );
    } catch (error) {
      release?.();
      this.endWithout(error instanceof Error ? error.message : "ACP could not start");
    }
  }

  private handoff(state: HandoffState, owner: LiveOwner): void {
    const handoff = { state, surface: owner.surface, host: HOST_NAME };
    this.flush();
    this.emit({ type: "status", id: this.id, seq: 0, text: handoffText(handoff), handoff });
  }

  /**
   * Reply into an existing Hermes session. A gateway-hosted CLI/TUI owner is one viewer of the
   * gateway that runs the session: the reply goes into that gateway now (next turn, or queued
   * behind a running one). Only a standalone owner that runs its own agent keeps the session:
   * then the reply waits (queued, nothing sent) until it closes. See src/hermes-continue.ts.
   */
  private continueHermes(input: TurnInput): void {
    const sessionId = input.sessionId;
    const target = sessionId ? hermesSessions.target(input.profileId, sessionId) : undefined;
    if (!sessionId || !target) { this.endWithout("Unknown or ambiguous Hermes profile/session."); return; }
    this.hermesProfile = target.profile;
    const release = claimContinuation(target.profile, sessionId);
    if (!release) { this.endWithout("A Dash reply is already queued or running in this Hermes session. Wait for it, or stop it first."); return; }
    const abort = new AbortController();
    this.abort = abort;
    log("turn.start", { id: this.id, harness: "hermes", cwd: input.cwd, resume: true });
    void (async () => {
      let handedOff = false;
      try {
        const hosting = (owner: LiveOwner) => hermesSessions.ownerHosting(target.profile, sessionId, owner);
        const plan = planContinuation(hermesSessions.liveOwner(target.profile, sessionId), hosting, hermesSessions.gatewayHosted(target.profile, sessionId));
        if (plan.kind === "live") {
          if (plan.owner) this.status(liveText(plan.owner.surface, HOST_NAME));
          log("hermes.live", { id: this.id, surface: plan.owner?.surface ?? "none", hosting: "gateway" });
        }
        const waited = plan.kind !== "handoff" ? undefined : await awaitHandoff({
          // Only an owner that runs its own agent blocks; a gateway viewer that appears meanwhile does not.
          owner: () => { const owner = hermesSessions.liveOwner(target.profile, sessionId); return owner && hosting(owner) === "standalone" ? owner : undefined; },
          signal: abort.signal,
          onQueued: owner => { this.handoff("queued", owner); log("hermes.handoff", { id: this.id, state: "queued", surface: owner.surface }); },
        });
        if (waited) { this.handoff("sending", waited); log("hermes.handoff", { id: this.id, state: "sending", surface: waited.surface }); }
        if (this.cancelled || this.finished) return;
        if (plan.kind === "live") {
          // Into the owning gateway, as one more client of the live session (src/hermes-live.ts).
          const hermesBin = Bun.which("hermes");
          const route = chooseHermesRoute({ home: hermesSessions.homeOf(target.profile), acpCommand: null, liveArgv: hermesBin ? liveArgv(hermesBin, sessionId) : null });
          if (route.kind !== "live") throw new Error(route.kind === "unavailable" ? route.reason : "No live route.");
          this.hermesTransport = "gateway";
          log("hermes.path", { path: "gateway" });
          const result = await sendIntoLiveSession({ argv: route.argv, home: route.home, sessionId, text: input.text, sink: this, cwd: input.cwd, signal: abort.signal });
          if (this.cancelled) { if (!this.finished) this.finish(CANCELLED_EXIT_CODE); return; }
          if (this.finished) return;
          this.session(result.sessionId);
          this.finish(0);
          log("turn.end", { id: this.id, harness: "hermes", exitCode: 0, path: "gateway" });
          return;
        }
        // Prefer the host's z0bridge daemon (ACP to `hermes -p <profile> acp`) once any live
        // owner has handed off. Fall back only when z0bridge is not running; its answer is final.
        const z0 = await z0bridgeHermes.ready();
        if (z0) {
          this.hermesTransport = "z0bridge";
          log("hermes.path", { path: "z0bridge" });
          const outcome = await z0bridgeHermes.continue(z0, { profile: target.profile, sessionId, text: input.text }, this, abort.signal);
          if (this.finished) return;
          if (this.cancelled || outcome.exitCode === "cancelled") { this.finish(CANCELLED_EXIT_CODE); return; }
          if (outcome.exitCode === 1) this.error(outcome.message);
          this.finish(outcome.exitCode);
          log("turn.end", { id: this.id, harness: "hermes", exitCode: outcome.exitCode, path: "z0bridge" });
          return;
        }
        const route = chooseHermesRoute({ api: target.api, home: hermesSessions.homeOf(target.profile), acpCommand: acpCommand("hermes") });
        if (route.kind === "unavailable") throw new Error(route.reason);
        if (route.kind === "live") throw new Error("Live route chosen without a live owner. Nothing was sent.");
        if (route.kind === "acp") {
          this.hermesTransport = "acp";
          log("hermes.path", { path: "acp" });
          handedOff = true;
          this.runAcp(route.command, input, { HERMES_HOME: route.home }, release);
          return;
        }
        this.hermesTransport = "api";
        // Native SSE: deltas and tool steps reach the phone live, and a long turn is bounded by
        // silence rather than a total timeout (the plain /chat call gave up after 120 s).
        const result = await streamHermesSession({ api: route.api, sessionId, text: input.text, sink: this, signal: abort.signal });
        if (this.cancelled) { if (!this.finished) this.finish(CANCELLED_EXIT_CODE); return; }
        if (this.finished) return;
        this.session(result.sessionId);
        this.finish(0);
        log("turn.end", { id: this.id, harness: "hermes", exitCode: 0, path: "api-stream", streamed: result.streamed });
      } catch (error) {
        if (this.cancelled) { if (!this.finished) this.finish(CANCELLED_EXIT_CODE); return; }
        if (this.finished) return;
        this.error(error instanceof HandoffAborted ? error.message : String(error));
        this.finish(1);
      } finally {
        if (!handedOff) release();
      }
    })();
  }

  private startHermes(input: TurnInput): void {
    const abort = new AbortController();
    this.abort = abort;
    log("turn.start", {
      id: this.id,
      harness: "hermes",
      cwd: input.cwd,
      resume: Boolean(input.sessionId),
    });
    void (async () => {
      try {
        const target = input.sessionId ? hermesSessions.target(input.profileId, input.sessionId) : undefined;
        if (target) this.hermesProfile = target.profile;
        if (input.sessionId && !target?.api) throw new Error("No native API configured for this Hermes profile. History is read-only until the host configures DASH_HERMES_APIS. CLI resume is not attempted.");
        const result = await runHermesSession({
          input,
          api: target?.api,
          env: process.env,
          log,
          signal: abort.signal,
        });
        if (this.cancelled) {
          if (!this.finished) this.finish(CANCELLED_EXIT_CODE);
          return;
        }
        if (this.finished) return;
        if (result.path === "cli") {
          this.spawnCli(input);
          return;
        }
        if (result.sessionId) this.session(result.sessionId);
        if (result.text) this.delta(result.text);
        this.finish(0);
        log("turn.end", { id: this.id, harness: "hermes", exitCode: 0, path: result.path });
      } catch (error) {
        if (this.cancelled) {
          if (!this.finished) this.finish(CANCELLED_EXIT_CODE);
          return;
        }
        if (this.finished) return;
        this.error(String(error));
        this.finish(1);
      }
    })();
  }

  private spawnCli(input: TurnInput): void {
    if (this.cancelled || this.finished) return;
    const parser = this.harness.parser(this);
    const proc = Bun.spawn([this.harness.bin, ...this.harness.argv(input)], {
      cwd: input.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" },
    });
    this.proc = proc;
    log("turn.start", {
      id: this.id,
      harness: this.harness.id,
      pid: proc.pid,
      cwd: input.cwd,
      resume: Boolean(input.sessionId),
    });

    let stderrTail = "";
    const stdoutDone = readLines(proc.stdout, (line) => {
      try {
        parser.line(line);
      } catch (error) {
        log("turn.parse_error", { id: this.id, error: String(error) });
      }
    });
    const stderrDone = readLines(proc.stderr, (line) => {
      stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL);
    });

    void (async () => {
      const timeoutMs = turnTimeoutMs();
      const { exitCode, timedOut } = await waitForExitOrTimeout(proc, timeoutMs);
      await Promise.all([stdoutDone, stderrDone]);
      parser.end();
      if (this.cancelled) {
        this.finish(CANCELLED_EXIT_CODE);
      } else if (timedOut) {
        this.error(timeoutMessage(this.harness.name, timeoutMs));
        this.finish(TIMEOUT_EXIT_CODE);
      } else {
        if (exitCode !== 0) {
          this.error(nonZeroExitMessage(this.harness.name, exitCode, stderrTail));
        }
        this.finish(exitCode);
      }
      log("turn.end", { id: this.id, harness: this.harness.id, exitCode, cancelled: this.cancelled, timedOut });
    })();
  }

  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    if (this.acp) { void this.acp.cancel(); return; }
    this.abort?.abort();
    if (!this.proc) {
      this.finish(CANCELLED_EXIT_CODE);
      return;
    }
    const proc = this.proc;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 3000);
  }

  /** Send every event after `afterSeq` to one socket. */
  replay(ws: Socket, afterSeq: number): void {
    for (const event of replayAfter(this.events, afterSeq)) sendTo(ws, event);
  }

  /** Re-subscribe after a drop: flush the coalesced batch, then replay. */
  attach(ws: Socket, afterSeq: number): void {
    for (const event of attachSocket(this, ws, afterSeq)) sendTo(ws, event);
  }

  // Sink -------------------------------------------------------------------

  session(sessionId: string): void {
    this.flush();
    this.emit({ type: "session", id: this.id, seq: 0, sessionId, hostId: SELF.id(), harnessId: this.harness.id, profileId: this.hermesProfile ? hermesSessionAgentId(this.hermesProfile, sessionId) : process.env.DASH_PROFILE_ID ?? "default", transport: this.hermesTransport ?? (this.hermesProfile ? "api" : process.env.DASH_ENABLE_LEGACY_CLI === "1" ? "legacy" : "acp") });
  }

  /** What we heard, for a turn the user spoke rather than typed. */
  transcript(text: string): void {
    this.emit({ type: "transcript", id: this.id, seq: 0, text });
  }

  /** End a turn that never spawned: transcription failed, or heard nothing. */
  endWithout(message?: string): void {
    if (this.finished) return;
    if (message) this.error(message);
    this.finish(message ? 1 : 0);
  }

  delta(text: string): void {
    if (!text) return;
    if (this.breakPending) {
      // Prose resumed after a tool call. Models rarely emit the separator themselves.
      this.breakPending = false;
      if (!this.textTail.endsWith("\n") && !text.startsWith("\n")) text = `\n\n${text.trimStart()}`;
    }
    this.buffer += text;
    this.textTail = (this.textTail + text).slice(-2);
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  status(text: string, acp?: AcpStatus): void {
    this.flush();
    if (text && this.textTail) this.breakPending = true;
    this.emit({ type: "status", id: this.id, seq: 0, text, ...(acp ? { acp } : {}) });
  }

  error(message: string): void {
    this.flush();
    this.emit({ type: "error", id: this.id, seq: 0, message });
  }

  private finish(exitCode: number): void {
    if (this.finished) return;
    this.flush();
    this.finished = true;
    this.emit({ type: "done", id: this.id, seq: 0, exitCode });
    setTimeout(() => turns.delete(this.id), RETAIN_MS);
    pruneTurns();
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer) {
      const text = this.buffer;
      this.buffer = "";
      this.emit({ type: "delta", id: this.id, seq: 0, text });
    }
  }

  private emit(event: TurnEvent): void {
    event.seq = this.events.length + 1;
    this.events.push(event);
    for (const ws of this.listeners) sendTo(ws, event);
  }
}

const turns = new Map<string, Turn>();

function pruneTurns(): void {
  if (turns.size <= MAX_RETAINED) return;
  for (const [id, turn] of turns) {
    if (turns.size <= MAX_RETAINED) break;
    if (turn.finished) turns.delete(id);
  }
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    let newline = rest.indexOf("\n");
    while (newline >= 0) {
      onLine(rest.slice(0, newline).replace(/\r$/, ""));
      rest = rest.slice(newline + 1);
      newline = rest.indexOf("\n");
    }
  }
  rest += decoder.decode();
  if (rest) onLine(rest);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = Number(process.env.DASH_PORT ?? "4747");
const DEFAULT_CWD = process.env.DASH_CWD ?? process.cwd();
const HOST_NAME = hostname();
const SELF = new SelfHost(HOST_NAME);
/** Roster for this bridge, remembering the id the phone uses for this computer. */
async function selfRoster(harnesses: HarnessInfo[], address?: string): Promise<HostInfo[]> {
  const hosts = await collectRoster(harnesses, { hostname: HOST_NAME, address });
  SELF.remember(hosts);
  return hosts;
}
/** True when a phone-supplied host id names this computer (refreshing the roster once if unknown). */
async function isSelfHost(hostId: string | undefined): Promise<boolean> {
  if (SELF.matches(hostId)) return true;
  await selfRoster(harnessList(), HOST);
  return SELF.matches(hostId);
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  const time = new Date().toISOString().slice(11, 19);
  const detail = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  process.stderr.write(`${time} ${event} ${detail}\n`);
}

function tailscaleIPv4(): string | null {
  try {
    const result = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return null;
    const ip = result.stdout.toString().split("\n").map((line) => line.trim()).find(isTailnetIPv4);
    return ip ?? null;
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function harnessList(): HarnessInfo[] {
  return HARNESSES.map((h) => ({ id: h.id, name: h.name, available: process.env.DASH_ENABLE_LEGACY_CLI === "1" ? Bun.which(h.bin) !== null : acpCommand(h.id) !== null }));
}

function parseJson(raw: string | Buffer): unknown {
  try {
    return JSON.parse(typeof raw === "string" ? raw : raw.toString());
  } catch {
    return null;
  }
}

function sendTo(ws: Socket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

/** A turn that failed before its process could start still needs a well-formed event stream. */
function rejectTurn(ws: Socket, id: string, message: string): void {
  sendTo(ws, { type: "error", id, seq: 1, message });
  sendTo(ws, { type: "done", id, seq: 2, exitCode: 1 });
}

// ---------------------------------------------------------------------------
// Spoken turns
// ---------------------------------------------------------------------------

/** Audio for a turn the phone is still streaming, before it has been transcribed. */
interface Utterance {
  chunks: Uint8Array[];
  bytes: number;
  cwd: string;
  sessionId?: string;
  profileId?: string;
  startedAt: number;
}

/** Utterances are seconds long; this only catches a runaway recorder. */
const MAX_UTTERANCE_BYTES = 4 * 1024 * 1024;

const utterances = new Map<string, Utterance>();

async function runVoiceTurn(turn: Turn, utterance: Utterance): Promise<void> {
  const audio = Buffer.concat(utterance.chunks);
  const uploadMs = Date.now() - utterance.startedAt;
  turn.status("Transcribing…");
  try {
    const heard = await transcribe(new Uint8Array(audio), turn.id);
    log("voice.heard", {
      id: turn.id,
      bytes: audio.byteLength,
      uploadMs,
      audioSec: Number(heard.audioSeconds.toFixed(2)),
      transcodeMs: heard.transcodeMs,
      sttMs: heard.sttMs,
      rtf: Number((heard.sttMs / 1000 / Math.max(heard.audioSeconds, 0.01)).toFixed(2)),
      chars: heard.text.length,
    });
    if (!heard.text) {
      // Silence or background noise. End quietly instead of showing an error;
      // in hands-free use this happens all the time.
      turn.endWithout();
      return;
    }
    turn.transcript(heard.text);
    turn.start({ text: heard.text, cwd: utterance.cwd, sessionId: utterance.sessionId, profileId: utterance.profileId });
  } catch (error) {
    log("voice.failed", { id: turn.id, error: String(error) });
    turn.endWithout(error instanceof Error ? error.message : String(error));
  }
}


let pairPlay: Promise<void> = Promise.resolve();
let pendingPairPlayback = 0;
function queuePairPlayback(code: string): void {
  if (pendingPairPlayback >= 2) return;
  pendingPairPlayback += 1;
  pairPlay = pairPlay
    .then(() => Promise.resolve(playPairCode(code)))
    .catch(() => {})
    .finally(() => { pendingPairPlayback -= 1; });
}

const tailscaleIp = tailscaleIPv4();
const HOST = resolveBridgeHost({
  tailnetIp: tailscaleIp,
  requestedHost: process.env.DASH_HOST,
  allowLoopback: process.env.DASH_ALLOW_LOOPBACK === "1",
});
const { token: TOKEN, bootstrapToken: BOOTSTRAP_TOKEN } = loadBridgeSecrets(process.env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash"));
const bridgeAuth = new BridgeAuth(TOKEN, configuredIdentity(), process.env.DASH_LEGACY_TOKEN !== "0");
const authorize = async (request: Request, queryLegacy = false) => Boolean(await bridgeAuth.authenticate(request, queryLegacy));
let bridgeAddress = `${HOST.includes(":") ? `[${HOST}]` : HOST}:${PORT}`;
const handleHttp = createPairingHttpHandler({
  bootstrapToken: BOOTSTRAP_TOKEN,
  authorize,
  legacyEnabled: process.env.DASH_LEGACY_TOKEN !== "0",
  token: TOKEN,
  hostname: HOST_NAME,
  get address() { return bridgeAddress; },
  cwd: DEFAULT_CWD,
  harnesses: harnessList,
  roster: () => selfRoster(harnessList(), HOST),
  pairing: { currentOrCreateSession, startBoundSession, claimSession },
  playCode: queuePairPlayback,
  decodeAudio: decodePairAudio,
  // Expo Go dogfood: Metro serves Dash on 8097 beside this bridge unless configured.
  expoGoOrigin: process.env.DASH_EXPO_GO_URL?.trim() || `${HOST.includes(":") ? `[${HOST}]` : HOST}:8097`,
  onEvent: log,
});

const CREDENTIAL_DIR = process.env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash");
const attachments = new AttachmentStore(process.env.DASH_ATTACHMENT_DIR?.trim() || join(CREDENTIAL_DIR, "attachments"));
const handleFiles = createFilesHttpHandler({
  token: TOKEN,
  store: attachments,
  authorize,
  shareRoots: () => shareRoots(defaultShareDirs(DEFAULT_CWD, attachments.root, homedir()), process.env.DASH_SHARE_DIRS, homedir()),
  device: process.env.DASH_KDECONNECT_DEVICE,
  run: bunRun,
  onEvent: log,
});

const handleSuggestions = createSuggestionsHttpHandler({ token: TOKEN, cwd: DEFAULT_CWD });

const gate = process.env.DASH_GATE_ENABLED === "1" ? new GateService(new GateStore(process.env.DASH_GATE_DIR), process.env.DASH_GATE_LIVE !== "1", undefined, process.env.DASH_GATE_OWNER_DECISIONS === "1") : null;
const liveSurface = new LiveSurface({ log });
const handleSupervision = createSupervisionHttpHandler({ token: TOKEN, directory: process.env.DASH_SUPERVISION_DIR });
const gatePoll = gate ? setInterval(() => { try { gate.refresh(); } catch { /* Explicit next request returns corruption error. */ } }, 2000) : null;

const server = Bun.serve<SocketData>({
  hostname: HOST,
  port: PORT,
  async fetch(request, server) {
    const url = new URL(request.url);
    // Native clients omit Origin; browser clients must use the exact bridge
    // origin or an explicitly configured origin. Never trust forwarded headers.
    const authority = `${HOST.includes(":") ? `[${HOST}]` : HOST}:${server.port}`;
    const origin = request.headers.get("origin");
    const origins = (process.env.DASH_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
    if ((request.headers.get("host") ?? url.host) !== authority ||
        (origin !== null && origin !== `http://${authority}` && !origins.includes(origin))) {
      return new Response("forbidden origin or host", { status: 403 });
    }
    if (url.pathname !== "/ws") {
      const cors = (response: Response): Response => {
        if (origin !== null) {
          response.headers.set("Access-Control-Allow-Origin", origin);
          response.headers.set("Vary", "Origin");
          response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        }
        return response;
      };
      // Only origins admitted above can preflight. The actual request still
      // requires the endpoint's separate bootstrap or execution credential.
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      const supervision = await handleSupervision(request);
      if (supervision) return cors(supervision);
      const phase = sessionPhaseHttp(request, secretMatches(bearerToken(request), TOKEN), (profile, session) => hermesSessions.phase(profile, session));
      if (phase) return cors(phase);
      const suggestions = await handleSuggestions(request);
      if (suggestions) return cors(suggestions);
      const files = await handleFiles(request);
      if (files) return cors(files);
      const http = await handleHttp(request, server.requestIP(request)?.address ?? null);
      return cors(http ?? new Response("not found", { status: 404 }));
    }
    const principal = await bridgeAuth.authenticate(request, true, true);
    if (!principal) {
      return new Response("unauthorized", { status: 401 });
    }
    if (server.upgrade(request, { data: { turns: new Set(), principal } })) return;
    return new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    idleTimeout: 0,
    async open(ws) {
      ws.data.stopIdentityWatch = bridgeAuth.identity?.watch(ws.data.principal, () => ws.close(1008, "Identity authorization expired or revoked"));
      log("ws.open", { remote: ws.remoteAddress });
      const harnesses = harnessList();
      sendTo(ws, {
        type: "hello",
        version: PROTOCOL_VERSION,
        host: HOST_NAME,
        cwd: DEFAULT_CWD,
        harnesses,
        hosts: await selfRoster(harnesses, tailscaleIp ?? undefined),
      });
    },
    async message(ws, raw) {
      if (ws.data.principal.kind === "identity" && ws.data.principal.expiresAt <= Date.now()) {
        ws.close(1008, "Identity authorization expired");
        return;
      }
      const message = parseClientMessage(parseJson(raw));
      if (!message) {
        log("ws.bad_message", { remote: ws.remoteAddress });
        return;
      }
      switch (message.type) {
        case "gate_list":
        case "gate_decide":
        case "gate_post": {
          if (!gate) { sendTo(ws, { type: "gate_error", message: "Approvals are not enabled on this bridge" }); break; }
          ws.data.gateSend ??= event => sendTo(ws, event);
          void gate.handle(message, ws.data.gateSend);
          break;
        }
        case "live_open":
        case "live_turn":
        case "live_intent":
        case "live_receipts": {
          // Fast lane of a Hermes chat: a libfx worker behind z0bridge on this host. Hermes stays in charge.
          void liveSurface.handle(message, event => sendTo(ws, event));
          break;
        }
        case "chat": {
          if (!(await isSelfHost(message.hostId))) return rejectTurn(ws, message.id, "Remote routing unavailable; connect to that host's authenticated bridge.");
          if (message.harness === "hermes" && message.sessionId) {
            if (!hermesSessions.target(message.profileId, message.sessionId)) return rejectTurn(ws, message.id, "Unknown or ambiguous Hermes profile/session.");
          } else if (message.harness === "omp" && message.profileId?.startsWith("omp:")) {
            const hosts = await selfRoster(harnessList(), HOST);
            if (!hosts.some(h => h.self && h.agents.some(a => a.id === message.profileId && a.sessionId === message.sessionId && a.status === "running"))) return rejectTurn(ws, message.id, "This OMP session has ended on the host.");
          } else if (message.profileId && message.profileId !== (process.env.DASH_PROFILE_ID ?? "default") && message.profileId !== `harness:${message.harness}` && !(message.harness === "hermes" && message.profileId === "hermes:default")) return rejectTurn(ws, message.id, "Profile routing unavailable on this bridge.");
          if (turns.has(message.id)) return;
          const harness = HARNESSES.find((h) => h.id === message.harness);
          if (!harness) return rejectTurn(ws, message.id, `Unknown agent "${message.harness}".`);
          if (!harnessList().find(h => h.id === harness.id)?.available) {
            return rejectTurn(
              ws,
              message.id,
              `${harness.name} isn't installed on ${HOST_NAME} ("${harness.bin}" not on PATH).`,
            );
          }
          const cwd = message.cwd?.trim() || DEFAULT_CWD;
          if (!isDirectory(cwd)) return rejectTurn(ws, message.id, `Not a directory on ${HOST_NAME}: ${cwd}`);

          let files: StoredAttachment[] = [];
          if (message.attachments?.length) {
            try { files = attachments.claim(message.id, message.attachments); }
            catch (error) { return rejectTurn(ws, message.id, error instanceof AttachmentError ? error.message : "Could not prepare the attachments on the host."); }
            log("turn.attachments", { id: message.id, count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) });
          }

          const turn = new Turn(message.id, harness);
          turn.listeners.add(ws);
          ws.data.turns.add(message.id);
          turns.set(message.id, turn);
          turn.start({ text: promptWithAttachments(message.text, files), cwd, sessionId: message.sessionId, profileId: message.profileId, ...(files.length ? { attachments: files } : {}) });
          break;
        }
        case "voice_begin": {
          if (!(await isSelfHost(message.hostId))) return rejectTurn(ws, message.id, "Remote routing unavailable; connect to that host's authenticated bridge.");
          if (message.harness === "hermes" && message.sessionId) {
            if (!hermesSessions.target(message.profileId, message.sessionId)) return rejectTurn(ws, message.id, "Unknown or ambiguous Hermes profile/session.");
          } else if (message.harness === "omp" && message.profileId?.startsWith("omp:")) {
            const hosts = await selfRoster(harnessList(), HOST);
            if (!hosts.some(h => h.self && h.agents.some(a => a.id === message.profileId && a.sessionId === message.sessionId && a.status === "running"))) return rejectTurn(ws, message.id, "This OMP session has ended on the host.");
          } else if (message.profileId && message.profileId !== (process.env.DASH_PROFILE_ID ?? "default") && message.profileId !== `harness:${message.harness}` && !(message.harness === "hermes" && message.profileId === "hermes:default")) return rejectTurn(ws, message.id, "Profile routing unavailable on this bridge.");
          if (turns.has(message.id) || utterances.has(message.id)) return;
          const ready = speechAvailable();
          if (!ready.ok) {
            return rejectTurn(ws, message.id, ready.reason ?? "Speech isn't set up on this computer.");
          }
          const harness = HARNESSES.find((h) => h.id === message.harness);
          if (!harness) return rejectTurn(ws, message.id, `Unknown agent "${message.harness}".`);
          if (!harnessList().find(h => h.id === harness.id)?.available) {
            return rejectTurn(
              ws,
              message.id,
              `${harness.name} isn't installed on ${HOST_NAME} ("${harness.bin}" not on PATH).`,
            );
          }
          const cwd = message.cwd?.trim() || DEFAULT_CWD;
          if (!isDirectory(cwd)) return rejectTurn(ws, message.id, `Not a directory on ${HOST_NAME}: ${cwd}`);

          const turn = new Turn(message.id, harness);
          turn.listeners.add(ws);
          ws.data.turns.add(message.id);
          turns.set(message.id, turn);
          utterances.set(message.id, {
            chunks: [],
            bytes: 0,
            cwd,
            sessionId: message.sessionId,
            profileId: message.profileId,
            startedAt: Date.now(),
          });
          break;
        }
        case "voice_chunk": {
          const utterance = utterances.get(message.id);
          if (!utterance) return;
          const slice = Buffer.from(message.data, "base64");
          utterance.bytes += slice.byteLength;
          if (utterance.bytes > MAX_UTTERANCE_BYTES) {
            utterances.delete(message.id);
            turns.get(message.id)?.endWithout("That recording was too long.");
            return;
          }
          utterance.chunks.push(new Uint8Array(slice));
          break;
        }
        case "voice_commit": {
          const pending = utterances.get(message.id);
          if (!pending) return;
          utterances.delete(message.id);
          const voiceTurn = turns.get(message.id);
          if (voiceTurn) void runVoiceTurn(voiceTurn, pending);
          break;
        }
        case "cancel": {
          utterances.delete(message.id);
          turns.get(message.id)?.cancel();
          break;
        }
        case "attach":
          for (const { id, seq } of message.turns) {
            const turn = turns.get(id);
            if (!turn) {
              sendTo(ws, { type: "lost", id });
              continue;
            }
            ws.data.turns.add(id);
            turn.attach(ws, seq);
          }
          log("ws.attach", { remote: ws.remoteAddress, count: message.turns.length });
          break;
        case "history": {
          if (message.harness === "hermes") {
            const target = hermesSessions.target(message.profileId, message.sessionId);
            const messages = (await isSelfHost(message.hostId)) && target
              ? (await z0bridgeHermes.history(target.profile, message.sessionId)) ?? await hermesSessions.history(target.profile, message.sessionId) : [];
            sendTo(ws, { type: "history", harness: message.harness, sessionId: message.sessionId, hostId: SELF.id(), profileId: target ? hermesSessionAgentId(target.profile, message.sessionId) : message.profileId, messages });
            break;
          }
          if (!(await isSelfHost(message.hostId)) || (message.profileId && message.profileId !== (process.env.DASH_PROFILE_ID ?? "default") && !message.profileId.startsWith("omp:"))) {
            sendTo(ws, { type: "history", harness: message.harness, sessionId: message.sessionId, messages: [] });
            break;
          }
          const home = homedir();
          const sessionRoot = join(process.env.PI_CODING_AGENT_DIR ?? join(home, ".omp", "agent"), "sessions");
          sendTo(ws, {
            type: "history",
            harness: message.harness,
            sessionId: message.sessionId,
            messages: readLiveTranscript(message.harness, message.sessionId, sessionRoot, message.cwd, home),
          });
          break;
        }
      }
    },
    close(ws) {
      ws.data.stopIdentityWatch?.();
      if (ws.data.gateSend) gate?.unsubscribe(ws.data.gateSend);
      detachSocket(ws.data.turns, (id) => turns.get(id), ws);
      for (const id of pruneStaleUtterances(utterances, Date.now())) {
        turns.get(id)?.endWithout("That recording was interrupted.");
      }
      log("ws.close", { remote: ws.remoteAddress, subscribed: ws.data.turns.size });
      ws.data.turns.clear();
    },
  },
});

bridgeAddress = `${HOST.includes(":") ? `[${HOST}]` : HOST}:${server.port}`;

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  if (gatePoll) clearInterval(gatePoll);
  // Stop admission before awaiting cleanup; sockets must not launch new work.
  server.stop(true);
  for (const turn of turns.values()) turn.cancel();
  void acpSupervisor.close().then(() => {
    log("bridge.stopped");
    process.exit(0);
  }, () => process.exit(1));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const agents = harnessList()
  .map((h) => `${h.id} ${h.available ? "✓" : "✗"}`)
  .join("  ");

const speech = speechAvailable();
if (speech.ok) {
  // Loading the model costs ~13s. Pay it now so the first spoken turn isn't the slow one.
  void warmup().then(
    () => log("speech.ready", {}),
    (error: unknown) => log("speech.load_failed", { error: String(error) }),
  );
}

process.stderr.write(
  [
    "",
    `  dash bridge   ws://${bridgeAddress}/ws`,
    `  computer      ${HOST_NAME}`,
    `  cwd           ${DEFAULT_CWD}`,
    `  agents        ${agents}`,
    `  voice         ${speech.ok ? "loading model…" : `unavailable — ${speech.reason ?? "not set up"}`}`,
    "",
    `  pairing       authenticated bootstrap; see bridge/PAIRING.md`,
    "",
    tailscaleIp
      ? `  Tailscale       ${tailscaleIp}:${server.port}  ·  computer name "${HOST_NAME}"`
      : "  loopback verification mode enabled explicitly",
    "",
  ].join("\n"),
);
