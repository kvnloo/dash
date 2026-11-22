import type { OwnerHosting } from "./hermes-gateway-host";
import type { LiveOwner } from "./hermes-owner";
import { surfaceLabel } from "./hermes-owner";
import type { HermesApi } from "./hermes-sessions";

/**
 * How Dash continues an existing Hermes session. This is the single seam for
 * continuation transports (z0bridge, the host's Hermes ACP daemon, plugs in here too).
 *
 * Who holds the session decides when Dash sends (`planContinuation`):
 *
 * - nobody: send now;
 * - a gateway-hosted session or owner (`live`): current Hermes runs CLI and TUI turns inside the
 *   profile's gateway, and the terminal is one viewer of many. Dash sends now, into that
 *   gateway, exactly as Desktop/TUI/ACP clients do: `prompt.submit` on the gateway's
 *   durable FIFO, so an idle session runs it as the next turn and a running turn gets it
 *   queued behind it. The CLI/TUI shows the turn because it watches the same session;
 * - a standalone process that runs its own agent (`handoff`): Dash never writes beside
 *   it; the reply waits for the owner to close (ordered handoff).
 *
 * Transports reuse Hermes's own clients:
 * - `live`: bridge-owned hermes-live.py uses GatewayChatView with attended admissions
 *   (see src/hermes-live.ts). It follows only its own admission; the gateway's ACP
 *   projection would also forward the terminal's own turns into Dash's reply;
 * - otherwise the native API `/api/sessions/{id}/chat` when the profile has one (host-only key);
 * - otherwise Hermes's ACP server (`hermes acp`, `session/load` + prompt) under that
 *   profile's HERMES_HOME.
 * Never a classic CLI that runs its own agent beside a live owner.
 */
export type HermesRoute =
  | { kind: "live"; argv: string[]; home: string }
  | { kind: "api"; api: HermesApi }
  | { kind: "acp"; command: string[]; home: string }
  | { kind: "unavailable"; reason: string };

export function chooseHermesRoute(input: { api?: HermesApi; home?: string; acpCommand: string[] | null; liveArgv?: string[] | null }): HermesRoute {
  // Into a live gateway-hosted session: Hermes's own thin client on the gateway FIFO the owner's
  // terminal uses. Nothing else is tried for it: a missing `hermes` is reported, not worked around.
  if (input.liveArgv !== undefined) {
    return input.liveArgv && input.home ? { kind: "live", argv: input.liveArgv, home: input.home }
      : { kind: "unavailable", reason: "The session is open on the host and the hermes command is not installed for Dash. Nothing was sent." };
  }
  if (input.api) return { kind: "api", api: input.api };
  if (input.acpCommand && input.home) return { kind: "acp", command: input.acpCommand, home: input.home };
  return { kind: "unavailable", reason: "Hermes ACP is not installed on this host and the profile has no native API. Nothing was sent." };
}

export type ContinuationPlan =
  | { kind: "free" }
  | { kind: "live"; owner?: LiveOwner }
  | { kind: "handoff"; owner: LiveOwner };

/**
 * When and where a Dash reply is sent. `gatewayHosted`: the session runs in its profile's gateway
 * (a TUI or Desktop showing it writes no lease, so this is checked even with no owner).
 */
export function planContinuation(owner: LiveOwner | undefined, hosting: (owner: LiveOwner) => OwnerHosting, gatewayHosted: boolean): ContinuationPlan {
  if (owner) return hosting(owner) === "gateway" ? { kind: "live", owner } : { kind: "handoff", owner };
  return gatewayHosted ? { kind: "live" } : { kind: "free" };
}

/**
 * A steer needs the gateway to host the session. When nothing hosts it (Dash's own ACP turn is
 * running it, or it is idle) the text goes as the next turn instead of being dropped (#498).
 */
export function steerFallsBackToQueue(mode: "steer" | "queue" | string | undefined, plan: ContinuationPlan["kind"], dashBusy = false): boolean {
  // While Dash's own reply is queued or running, a gateway steer would overtake it: queue instead.
  return mode === "steer" && (plan !== "live" || dashBusy);
}

/** True while a Dash reply in this session is queued, waiting or running. */
export function dashReplyBusy(profile: string, sessionId: string): boolean {
  return continuing.has(`${profile}\u0000${sessionId}`) || Boolean(runningTurns.get(sessionId)?.size);
}

/** Dash's own running Hermes turns, by session id. A follow-up waits for these, never races them. */
const runningTurns = new Map<string, Set<() => void>>();
const runningWaiters = new Map<string, Set<() => void>>();

/** Mark a Dash turn as running `sessionId`; call the returned function once it ends. */
export function trackRunningTurn(sessionId: string): () => void {
  let ended = false;
  const token = () => {};
  const set = runningTurns.get(sessionId) ?? new Set<() => void>();
  set.add(token);
  runningTurns.set(sessionId, set);
  return () => {
    if (ended) return;
    ended = true;
    set.delete(token);
    if (set.size) return;
    runningTurns.delete(sessionId);
    for (const wake of runningWaiters.get(sessionId) ?? []) wake();
    runningWaiters.delete(sessionId);
  };
}

/** Resolves true after waiting for Dash's running turn(s) in `sessionId`, false when none ran. */
export async function awaitRunningTurn(sessionId: string, signal: AbortSignal): Promise<boolean> {
  if (!runningTurns.get(sessionId)?.size) return false;
  await new Promise<void>((resolve, reject) => {
    const waiters = runningWaiters.get(sessionId) ?? new Set<() => void>();
    runningWaiters.set(sessionId, waiters);
    const wake = () => { signal.removeEventListener("abort", stop); resolve(); };
    const stop = () => { waiters.delete(wake); reject(new HandoffAborted()); };
    waiters.add(wake);
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
  return true;
}

/** Status for a reply sent into a session another surface has open through the same gateway. */
export function liveText(surface: string, host: string): string {
  return `Open in ${surfaceLabel(surface)} on ${host} · sending into the live session`;
}

export type HandoffState = "queued" | "sending";
export type HandoffStatus = { state: HandoffState; surface: string; host: string };

export function handoffText(status: HandoffStatus): string {
  const surface = surfaceLabel(status.surface);
  return status.state === "queued"
    ? `Open in ${surface} on ${status.host} · reply queued until it closes`
    : `${surface} on ${status.host} closed · sending queued reply`;
}

export class HandoffAborted extends Error {
  constructor(message = "Queued reply cancelled before the handoff. Nothing was sent.") { super(message); }
}

/** One waiting/continuing Dash reply per profile session. */
const continuing = new Set<string>();

/** Follow-ups waiting for the session, oldest first. Release hands the slot to the next one (#498). */
const continuationWaiters = new Map<string, Array<(release: () => void) => void>>();

function holdContinuation(key: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = continuationWaiters.get(key)?.shift();
    if (!continuationWaiters.get(key)?.length) continuationWaiters.delete(key);
    if (next) next(holdContinuation(key));
    else continuing.delete(key);
  };
}

export function claimContinuation(profile: string, sessionId: string): (() => void) | undefined {
  const key = `${profile}\u0000${sessionId}`;
  if (continuing.has(key)) return undefined;
  continuing.add(key);
  return holdContinuation(key);
}

/** Like claimContinuation, but waits its turn (FIFO) instead of rejecting a message sent in a burst. */
export function queueContinuation(profile: string, sessionId: string, signal: AbortSignal): Promise<() => void> {
  const release = claimContinuation(profile, sessionId);
  if (release) return Promise.resolve(release);
  const key = `${profile}\u0000${sessionId}`;
  return new Promise((resolve, reject) => {
    const waiters = continuationWaiters.get(key) ?? [];
    continuationWaiters.set(key, waiters);
    const take = (granted: () => void) => { signal.removeEventListener("abort", stop); resolve(granted); };
    const stop = () => {
      const at = waiters.indexOf(take);
      if (at >= 0) waiters.splice(at, 1);
      if (!waiters.length) continuationWaiters.delete(key);
      reject(new HandoffAborted());
    };
    waiters.push(take);
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Wait until no live owner holds the session. Resolves with the owner that was
 * waited for (undefined when none held it). Rejects on abort or when the wait
 * outlives `maxWaitMs`; in both cases nothing has been sent.
 */
export async function awaitHandoff(options: {
  owner(): LiveOwner | undefined;
  signal: AbortSignal;
  onQueued(owner: LiveOwner): void;
  pollMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<LiveOwner | undefined> {
  const first = options.owner();
  if (!first) return undefined;
  options.onQueued(first);
  const pollMs = options.pollMs ?? 2_000;
  const deadline = Date.now() + (options.maxWaitMs ?? 12 * 60 * 60 * 1000);
  const sleep = options.sleep ?? abortableSleep;
  for (;;) {
    if (options.signal.aborted) throw new HandoffAborted();
    if (Date.now() >= deadline) throw new HandoffAborted("The session stayed open on the host too long. The queued reply was not sent.");
    await sleep(pollMs, options.signal);
    if (options.signal.aborted) throw new HandoffAborted();
    if (!options.owner()) return first;
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
  });
}
