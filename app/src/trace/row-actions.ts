import { summarizeRow, type TraceRow } from "./model";

export type RowActionId = "open" | "zoom" | "copy-request" | "copy-source" | "copy-summary";
export type RowAction = { id: RowActionId; label: string };

/** Actions for one pressed row. Copy actions appear only when this row carries the data. */
export function rowActionsFor(row: TraceRow): RowAction[] {
  const source = row.provenance?.source ?? row.evidence?.intent.provenance.source;
  return [
    { id: "open", label: "Open details" },
    { id: "zoom", label: "Zoom to this run" },
    ...(row.evidence?.quote ? [{ id: "copy-request" as const, label: "Copy original request" }] : []),
    ...(source ? [{ id: "copy-source" as const, label: "Copy source path" }] : []),
    { id: "copy-summary", label: "Copy summary" },
  ];
}

export function rowClipboardText(row: TraceRow, id: RowActionId): string | null {
  if (id === "copy-request") return row.evidence?.quote || null;
  if (id === "copy-source") return row.provenance?.source ?? row.evidence?.intent.provenance.source ?? null;
  if (id !== "copy-summary") return null;
  const m = summarizeRow(row);
  return `${row.project} · ${row.goal}\n${m.workers} workers · ${m.calls} calls · ${m.errors} errors${m.cut ? ` · ${m.cut} cut` : ""}${m.live ? " · live" : ""}`;
}
