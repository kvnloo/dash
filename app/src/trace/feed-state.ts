import { demoSnapshot, type TraceFeed } from "./source";

export const TRACE_POLL_MS = 5000;

export const ago = (ms: number): string => ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : `${Math.round(ms / 60000)} min ago`;

export function unavailableReason(error: unknown): string {
  if (error instanceof Error && error.message.includes("no live source data")) return "No live sessions or source observations reported by this bridge";
  if (error instanceof Error && error.message.includes("stale source snapshot")) return "Bridge returned a stale source snapshot";
  if (error instanceof Error && /HTTP \d+/.test(error.message)) return error.message.replace(/^Trace unavailable/, "Live trace endpoint unavailable");
  if (error instanceof Error && error.name === "AbortError") return "Bridge did not answer within 12 s";
  if (error instanceof Error && /^Invalid|trace/i.test(error.message)) return "Bridge sent an unreadable trace snapshot";
  return "Bridge unreachable";
}

/** Owner-facing line for every feed phase. Production Trace has no sample fallback. */
export function feedStatus(feed: TraceFeed, now: number): { title: string; detail: string } {
  if (feed.phase === "unpaired") return { title: "Live trace unavailable · not paired", detail: "Pair with your computer's bridge to see its sessions, runs and fleet jobs. No sample data is shown here." };
  if (feed.phase === "connecting") return { title: "Connecting to bridge…", detail: "Loading live events from the paired bridge." };
  if (feed.phase === "unavailable") return { title: `Live trace unavailable · ${feed.reason}`, detail: `Retrying every ${TRACE_POLL_MS / 1000} s.${feed.lastLiveAt ? ` Last live update ${ago(now - feed.lastLiveAt)}; its events were cleared, not kept as current.` : " No events have loaded from this bridge yet."}` };
  return { title: `Live from bridge · updated ${ago(now - feed.receivedAt)}`, detail: "" };
}

/** A bundled export's trace clock is local/unspecified, not a live update or a UTC receipt. */
export const BUNDLED_TRACE_TIME = new Date(
  Date.parse(`${demoSnapshot.t0}Z`) + demoSnapshot.now * 1000,
).toISOString().slice(0, 16).replace("T", " ");

const bundledNotice = `Bundled snapshot · ${BUNDLED_TRACE_TIME} (trace clock) · demo only, not live`;
const TRACE_FRESH_MS = 30_000;

/** Never advertise old bridge counts as live while the owner is away from Trace. */
export function isFreshBridgeTrace(feed: TraceFeed, now: number): boolean {
  return feed.phase === "live" && now >= feed.receivedAt && now - feed.receivedAt <= TRACE_FRESH_MS;
}

/** Owner-facing trace origin. Only an admitted, recent bridge sample gets live numbers. */
export function entryLine(feed: TraceFeed, paired: boolean, now = Date.now()): string {
  if (feed.phase === "live" && isFreshBridgeTrace(feed, now)) {
    const st = feed.snapshot.stats;
    return `Live from bridge · ${st.live} live · ${st.cut} cut · ${st.asks} needs OK · ${feed.snapshot.rows.length} events`;
  }
  if (feed.phase === "live") return `Last bridge update expired · ${bundledNotice}`;
  if (feed.phase === "unavailable") return `Live trace unavailable · ${feed.reason} · ${bundledNotice}`;
  if (feed.phase === "connecting") return `Loading bridge trace · ${bundledNotice}`;
  return `${paired ? "Bridge trace not loaded" : "Not paired"} · ${bundledNotice}`;
}
