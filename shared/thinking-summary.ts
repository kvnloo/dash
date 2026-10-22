export type SummaryFailure = "transport_unavailable" | "credential_unavailable" | "provider_unavailable" | "invalid_response" | "model_mismatch" | "deadline" | "aborted" | "role_unavailable";
export function isSummaryFailure(value: unknown): value is SummaryFailure {
  return value === "transport_unavailable" || value === "credential_unavailable" || value === "provider_unavailable" || value === "invalid_response" || value === "model_mismatch" || value === "deadline" || value === "aborted" || value === "role_unavailable";
}
export interface SummaryInfo {
  blockId: string;
  kind: "live" | "final" | "turn";
  text: string;
  model: string;
  durationMs: number;
  /** Absent on successful/legacy summaries. Only safe codes cross the wire. */
  unavailable?: SummaryFailure;
}
export function summaryLabel(summary: SummaryInfo): string {
  return summary.unavailable ? summary.text : `Thought ${Math.round(summary.durationMs / 1000)} s · ${summary.text}`;
}
export function parseSummary(value: unknown): SummaryInfo | undefined {
  if (value === null || typeof value !== "object" || !("blockId" in value) || !("kind" in value) || !("text" in value) || !("model" in value) || !("durationMs" in value)) return undefined;
  if (typeof value.blockId !== "string" || !value.blockId || (value.kind !== "live" && value.kind !== "final" && value.kind !== "turn") ||
      typeof value.text !== "string" || value.text.length > 280 || typeof value.model !== "string" ||
      typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0) return undefined;
  const unavailable = "unavailable" in value ? value.unavailable : undefined;
  if (unavailable !== undefined && !isSummaryFailure(unavailable)) return undefined;
  return { blockId: value.blockId, kind: value.kind, text: value.text, model: value.model, durationMs: value.durationMs, ...(unavailable ? { unavailable } : {}) };
}
