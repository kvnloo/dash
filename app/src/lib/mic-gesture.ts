export type MicChoice = "dictate" | "live";

/** Remembered tap default. */
export const MIC_DEFAULT_KEY = "dash.mic.default";
export function parseMicChoice(raw: unknown): MicChoice {
  return raw === "live" ? "live" : "dictate";
}

export interface Selection { start: number; end: number }

/** Replace the selection with `insert`, padding with single spaces so repeated dictation appends words cleanly. */
export function insertAtCursor(text: string, selection: Selection | null | undefined, insert: string): { text: string; cursor: number } {
  const clean = insert.trim();
  const len = text.length;
  const start = Math.max(0, Math.min(selection?.start ?? len, len));
  const end = Math.max(start, Math.min(selection?.end ?? start, len));
  if (!clean) return { text, cursor: end };
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const piece = lead + clean + trail;
  return { text: before + piece + after, cursor: start + lead.length + clean.length };
}
