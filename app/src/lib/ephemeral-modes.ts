// Pure parts of the Learn and Quick surfaces (prompts, blocker ordering, pill cycle). No React Native.
import type { TriageItem, TriageSnapshot } from "../../../shared/triage";

export type PillMode = "normal" | "annotate" | "learn" | "quick";
export const PILL_LABEL: Record<PillMode, string> = { normal: "Normal", annotate: "Annotate", learn: "Learn", quick: "Quick" };
// Annotate is last: its full-screen ink overlay covers the nav pill, so nothing can be cycled
// after it. The tray's Exit chip and Android Back leave Annotate (to Normal).
const NEXT: Record<PillMode, PillMode> = { normal: "learn", learn: "quick", quick: "annotate", annotate: "normal" };
/** Pill tap: Normal → Learn → Quick → Annotate; Exit/Back leaves Annotate. */
export function nextPillMode(mode: PillMode): PillMode { return NEXT[mode]; }
export function pillModeOf(annotating: boolean, surface: "learn" | "quick" | null): PillMode {
  if (annotating) return "annotate";
  return surface ?? "normal";
}

export type LearnIntent = "explain" | "quiz" | "map";

// Dash renders only a strict subset (lib/genui.ts, lib/mermaid.ts); anything else falls back to code.
const LEARN_FORMAT = [
  "Answer as Dash ephemeral UI, not prose. One idea per card, plain words, no preamble.",
  "1) One ```genui block: {\"version\":1,\"components\":[...]}. Each widget uses ONLY the keys type, title, text, value, columns, rows, items, children, id (no other keys; put a card's words in \"text\").",
  "Types: card, stat, table, progress (value 0-100), choices, buttons, checklist, timeline. choices/buttons/checklist need an \"id\" and items [{\"id\":\"a\",\"label\":\"...\"}].",
  "2) When a picture helps, one ```mermaid block: first line \"flowchart TD\", then one edge per line as A[label] --> B[label] or A -->|label| B; nodes may be A[text] or B{question}. No \"-- label -->\" edges, no subgraph, no styles, at most 10 nodes.",
].join("\n");

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

