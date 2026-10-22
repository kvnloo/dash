import type { TraceFeed } from "./source";

export const TRACE_POLL_MS = 5000;

export const ago = (ms: number): string => ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : `${Math.round(ms / 60000)} min ago`;

export function unavailableReason(error: unknown): string {
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

export function entryLine(feed: TraceFeed): string {
  if (feed.phase === "unpaired") return "Not paired · live trace unavailable";
  if (feed.phase === "connecting") return "Open to load live events";
  if (feed.phase === "unavailable") return `Live trace unavailable · ${feed.reason}`;
  const st = feed.snapshot.stats;
  return `${st.live} live · ${st.cut} cut · ${st.asks} need your OK · ${feed.snapshot.rows.length} events`;
}
