import type { ReplyPart } from "../../shared/protocol";

export const PREVIEW_BYTES = 8192;
export const DETAIL_BYTES = 1024 * 1024;
export function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function stringify(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value ?? "") ?? ""; }
import { formatTool, object, redactTool } from "../../shared/tool-format";
export const redact = redactTool;
export function redactValue(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)$/i.test(key) ? "[REDACTED]" : typeof item === "string" ? redact(item) : record(item) ? redactValue(item) : Array.isArray(item) ? item.map(entry => record(entry) ? redactValue(entry) : typeof entry === "string" ? redact(entry) : entry) : item;
  return out;
}
export function statusUpdate(value: Record<string, unknown>): Record<string, unknown> {
  if (value.sessionUpdate !== "tool_call" && value.sessionUpdate !== "tool_call_update") return redactValue(value);
  const out: Record<string, unknown> = {};
  for (const key of ["sessionUpdate", "toolCallId", "title", "status", "kind"]) if (typeof value[key] === "string") out[key] = cap(redact(value[key]), 256);
  return out;
}
export function cap(text: string, bytes: number): string {
  const encoded = new TextEncoder().encode(text);
  return encoded.length <= bytes ? text : new TextDecoder("utf-8", { fatal: false }).decode(encoded.slice(0, bytes)).replace(/\uFFFD$/, "");
}
export function contentText(value: unknown): string {
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
  if (record(value)) return typeof value.text === "string" ? value.text : "content" in value ? contentText(value.content) : stringify(value);
  return stringify(value);
}
/** Adapter-local identity/timing; no names used to identify parallel same-name calls. */
export class PartEmitter {
  private starts = new Map<string, number>();
  private names = new Map<string, string>();
  private pending = new Map<string, string>();
  private sent = new Map<string, number>();
  private envCalls = new Set<string>();
  constructor(private emit: (part: ReplyPart) => void, private now = Date.now) {}
  reasoning(text: unknown): void { if (typeof text === "string" && text) this.emit({ kind: "reasoning", text: redact(text) }); }
  start(id: string, name: string, args: unknown): void {
    if (!this.starts.has(id) && this.starts.size >= 128) return;
    if (!this.starts.has(id)) this.starts.set(id, this.now());
    this.names.set(id, name);
    const raw = stringify(args);
    let parsed: Record<string, unknown> = {};
    try { parsed = object(JSON.parse(raw)); } catch { /* ACP command text */ }
    if (/(^|\/)\.env(?:\.|$)/.test(String(parsed.path ?? parsed.file_path ?? ""))) this.envCalls.add(id);
    const formatted = formatTool({ name, args: raw, output: "", status: "live", durationMs: 0 });
    const clean = cap(this.envCalls.has(id) ? formatted.args : redact(raw), DETAIL_BYTES);
    this.emit({ kind: "tool_start", callId: id, name: redact(name), summary: formatted.title, args: clean });
  }
  args(id: string, value: unknown): void { const name = this.names.get(id); if (name) this.start(id, name, value); }
  output(id: string, value: unknown, final = false): void {
    // Keep the unfinished line private: a token split over transport chunks must not leak.
    const pending = cap((this.pending.get(id) ?? "") + contentText(value), DETAIL_BYTES);
    const boundary = final ? pending.length : pending.lastIndexOf("\n") + 1;
    if (!boundary) { this.pending.set(id, pending); return; }
    this.pending.set(id, pending.slice(boundary));
    const clean = this.envCalls.has(id) ? "[REDACTED .env values]" : redact(pending.slice(0, boundary));
    const used = this.sent.get(id) ?? 0;
    const text = cap(clean, Math.max(0, DETAIL_BYTES - used));
    this.sent.set(id, used + new TextEncoder().encode(text).length);
    this.emit({ kind: "tool_output", callId: id, text, truncated: text !== clean });
  }
  finish(id: string, error = false, duration?: number): void {
    this.output(id, "", true);
    this.emit({ kind: "tool_finish", callId: id, status: error ? "error" : "ok", durationMs: typeof duration === "number" && Number.isFinite(duration) ? Math.max(0, duration) : Math.max(0, this.now() - (this.starts.get(id) ?? this.now())) });
  }
}

/** Hermes stream-json fields, including gateway-compatible reasoning aliases. */
export function hermesParts(value: unknown, parts: PartEmitter): void {
  if (!record(value)) return;
  const id = typeof value.tool_call_id === "string" ? value.tool_call_id : typeof value.id === "string" ? value.id : typeof value.name === "string" ? `legacy:${value.name}` : "legacy:tool";
  switch (value.type) {
    case "reasoning": case "thinking": case "reasoning_delta": case "thinking_delta": parts.reasoning(value.text ?? value.delta ?? value.reasoning ?? value.thinking); break;
    case "tool_use": parts.start(id, typeof value.name === "string" ? value.name : "tool", value.input ?? value.arguments ?? value.args); break;
    case "tool_result": parts.output(id, value.output ?? value.result ?? "", true); parts.finish(id, value.is_error === true, typeof value.duration_ms === "number" ? value.duration_ms : undefined); break;
  }
}
export function acpParts(update: Record<string, unknown>, parts: PartEmitter): void {
  if (update.sessionUpdate === "agent_thought_chunk") { if (record(update.content)) parts.reasoning(update.content.text); return; }
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
  if (typeof update.toolCallId !== "string") return;
  const id = update.toolCallId;
  if (update.sessionUpdate === "tool_call_update" && update.rawInput !== undefined) parts.args(id, update.rawInput);
  if (update.sessionUpdate === "tool_call") parts.start(id, typeof update.title === "string" ? update.title.split(":")[0] ?? update.title : typeof update.kind === "string" ? update.kind : "tool", update.rawInput ?? contentText(update.content));
  if (update.sessionUpdate === "tool_call_update" && (update.rawOutput !== undefined || update.content !== undefined)) parts.output(id, update.rawOutput ?? update.content, true);
  if (update.status === "completed" || update.status === "failed") parts.finish(id, update.status === "failed");
}
