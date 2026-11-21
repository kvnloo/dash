// Pure parts of the Learn and Quick surfaces (prompts, blocker ordering, pill cycle). No React Native.
import type { TriageItem, TriageSnapshot } from "../../../shared/triage";

export type PillMode = "normal" | "annotate" | "learn" | "quick";
export const PILL_LABEL: Record<PillMode, string> = { normal: "Normal", annotate: "Annotate", learn: "Learn", quick: "Quick" };
const NEXT: Record<PillMode, PillMode> = { normal: "annotate", annotate: "learn", learn: "quick", quick: "normal" };
/** Pill tap: Normal → Annotate → Learn → Quick → Normal. */
export function nextPillMode(mode: PillMode): PillMode { return NEXT[mode]; }
export function pillModeOf(annotating: boolean, surface: "learn" | "quick" | null): PillMode {
  if (annotating) return "annotate";
  return surface ?? "normal";
}

export type LearnIntent = "explain" | "quiz" | "map";

const LEARN_FORMAT = "Answer as Dash ephemeral UI, not prose: one ```genui block (JSON {\"version\":1,\"components\":[...]}; widget types card, stat, table, progress, choices, buttons, checklist, timeline; choices/buttons/checklist need an \"id\" and items [{\"id\",\"label\"}]) and, when a picture helps, one ```mermaid block starting \"flowchart TD\" (at most 10 nodes). One idea per card, plain words, no preamble.";

const LEARN_ASK: Record<LearnIntent, string> = {
  explain: "Explain it in 3 to 5 cards plus a small flowchart, and end with one check-yourself question as a choices widget (id \"check\").",
  quiz: "Quiz me: one multiple-choice question as a choices widget (id \"quiz\", 3 or 4 items). When I answer, grade it in one card and ask the next question.",
  map: "Map it: a mermaid flowchart TD concept map (at most 10 nodes) and a table or timeline of the key parts.",
};

export function learnPrompt(intent: LearnIntent, topic: string): string {
  return `[Dash · Learn mode · ${intent}] Topic: ${topic.trim()}\n${LEARN_ASK[intent]}\n${LEARN_FORMAT}`;
}

export function unblockPrompt(item: TriageItem): string {
  return [
    `[Dash · Quick action · Unblock] ${item.title}`,
    `Source: ${item.source} (${item.kind})`,
    `Blocked because: ${item.reason}`,
    `Suggested next: ${item.next}`,
    "Unblock it now if one command can do it; otherwise reply with the single decision you need from me as a ```genui buttons widget (id \"decision\").",
  ].join("\n");
}

/** Blockers first (needs you, then blocked), newest first; running work is only counted. */
export function quickItems(snapshot: TriageSnapshot, hidden: ReadonlySet<string>): TriageItem[] {
  const rank = (item: TriageItem) => (item.kind === "owner" ? 0 : 1);
  return snapshot.items
    .filter(item => (item.kind === "owner" || item.kind === "blocked") && !hidden.has(item.id))
    .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 8);
}

