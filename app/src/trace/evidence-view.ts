import type { TraceArtifact, TraceEvidence } from "../../../shared/trace-evidence";

export const KIND_LABEL: Record<TraceArtifact["kind"], string> = { image: "Images", storyboard: "Storyboards", file: "Files and receipts", pr: "Pull requests", commit: "Commits", page: "Web pages", dash: "In-app links" };
const KIND_ORDER: TraceArtifact["kind"][] = ["image", "storyboard", "pr", "commit", "file", "page", "dash"];
export function byKind(artifacts: TraceArtifact[]): [TraceArtifact["kind"], TraceArtifact[]][] {
  return KIND_ORDER.map((k): [TraceArtifact["kind"], TraceArtifact[]] => [k, artifacts.filter(a => a.kind === k)]).filter(([, g]) => g.length > 0);
}
/** The extractor falls back to the request's opening when no goal is stated; say so instead of repeating it. */
export function goalLine(evidence: TraceEvidence): string {
  const flat = (t: string) => t.replace(/\s+/g, " ").replace(/…$/, "").trim();
  const goal = flat(evidence.intent.constraints.goal);
  // Without a recorded request the extractor's goal is a placeholder, not a stated goal.
  if (!goal || !evidence.quote) return "Unknown · no goal stated";
  if (evidence.quote && flat(evidence.quote).startsWith(goal.slice(0, 80))) return "Not stated separately · the request above is the goal";
  return goal.length > 240 ? `${goal.slice(0, 240)}…` : goal;
}
