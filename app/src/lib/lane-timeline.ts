import type { Z0Lane } from "../../../shared/z0live-lanes";

/** Elapsed seconds as a compact clock: 45s, 2m 05s, 1h 02m. Negative (clock skew) reads as 0s. */
export function formatElapsed(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** What one lane row says under its name. */
export function laneNow(lane: Z0Lane): string {
  if (lane.status === "working") return lane.step ?? "Working";
  if (lane.status === "error") return `Failed · ${lane.step ?? "no detail"}`;
  return lane.handoff ? "Idle · handed back" : "Idle · attached";
}

/** The right-hand clock: time on the current step, or time since the handoff/error. */
export function laneElapsed(lane: Z0Lane, now: number): string {
  const elapsed = formatElapsed(now - lane.since);
  return lane.status === "working" ? elapsed : `${elapsed} ago`;
}

/** The collapsed panel's single line: counts, then the lane that changed most recently. */
export function laneSummary(lanes: readonly Z0Lane[]): string {
  if (!lanes.length) return "No lanes attached";
  const working = lanes.filter(lane => lane.status === "working").length;
  const failed = lanes.filter(lane => lane.status === "error").length;
  const parts = [`${lanes.length} lane${lanes.length === 1 ? "" : "s"}`, working ? `${working} working` : "all idle"];
  if (failed) parts.push(`${failed} failed`);
  const latest = lanes.reduce((a, b) => (b.since > a.since ? b : a));
  parts.push(latest.status === "working" ? `${latest.name}: ${latest.step ?? "working"}`
    : latest.status === "error" ? `${latest.name} failed`
    : latest.handoff ? `${latest.name} handed back` : `${latest.name} attached`);
  return parts.join(" · ");
}
