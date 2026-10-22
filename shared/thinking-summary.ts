export interface SummaryInfo {
  blockId: string;
  kind: "live" | "final" | "turn";
  text: string;
  model: string;
  durationMs: number;
}
export function parseSummary(value: unknown): SummaryInfo | undefined {
  if (value === null || typeof value !== "object" || !("blockId" in value) || !("kind" in value) || !("text" in value) || !("model" in value) || !("durationMs" in value)) return undefined;
  if (typeof value.blockId !== "string" || !value.blockId || (value.kind !== "live" && value.kind !== "final" && value.kind !== "turn") ||
      typeof value.text !== "string" || value.text.length > 280 || typeof value.model !== "string" ||
      typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0) return undefined;
  return { blockId: value.blockId, kind: value.kind, text: value.text, model: value.model, durationMs: value.durationMs };
}
