import type { LiveOwner } from "./hermes-owner";
import { surfaceLabel } from "./hermes-owner";
import type { HermesApi } from "./hermes-sessions";

/**
 * How Dash continues an existing Hermes session. This is the single seam for
 * continuation transports: z0bridge (Hermes ACP bridge, built separately) plugs
 * in here as another `HermesRoute` kind once it can take a live owner's turn
 * itself. Until then Dash never writes beside a live owner; it waits for the
 * owner to close (ordered handoff) and then uses Hermes's own transports:
 *
 * 1. native API `/api/sessions/{id}/chat` when the profile has one (host-only key);
 * 2. otherwise Hermes's own ACP server (`hermes acp`, `session/load` + prompt)
 *    under that profile's HERMES_HOME. Never a second classic CLI `--resume`.
 */
export type HermesRoute =
  | { kind: "api"; api: HermesApi }
  | { kind: "acp"; command: string[]; home: string }
  | { kind: "unavailable"; reason: string };

export function chooseHermesRoute(input: { api?: HermesApi; home?: string; acpCommand: string[] | null }): HermesRoute {
  if (input.api) return { kind: "api", api: input.api };
  if (input.acpCommand && input.home) return { kind: "acp", command: input.acpCommand, home: input.home };
  return { kind: "unavailable", reason: "Hermes ACP is not installed on this host and the profile has no native API. Nothing was sent." };
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

export function claimContinuation(profile: string, sessionId: string): (() => void) | undefined {
  const key = `${profile}\u0000${sessionId}`;
  if (continuing.has(key)) return undefined;
  continuing.add(key);
  let released = false;
  return () => { if (!released) { released = true; continuing.delete(key); } };
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
