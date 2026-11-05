/** Optional status payload: v1 clients continue to consume the legacy status text. */
export type ReplyPart =
  | { kind: "reasoning"; text: string }
  | { kind: "tool_start"; callId: string; name: string; summary: string; args: string; truncated?: boolean }
  | { kind: "tool_output"; callId: string; text: string; truncated: boolean }
  | { kind: "tool_finish"; callId: string; status: "ok" | "error"; durationMs: number }
  | { kind: "tool_detail"; callId: string; args: string; text: string; truncated: boolean };

export function parseReplyPart(raw: unknown): ReplyPart | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  if (!("kind" in raw)) return null;
  switch (raw.kind) {
    case "reasoning": return "text" in raw && typeof raw.text === "string" ? { kind: raw.kind, text: raw.text } : null;
    case "tool_start": return "callId" in raw && typeof raw.callId === "string" && "name" in raw && typeof raw.name === "string" && "summary" in raw && typeof raw.summary === "string" && "args" in raw && typeof raw.args === "string" ? { kind: raw.kind, callId: raw.callId, name: raw.name, summary: raw.summary, args: raw.args, ...("truncated" in raw && typeof raw.truncated === "boolean" ? { truncated: raw.truncated } : {}) } : null;
    case "tool_output": return "callId" in raw && typeof raw.callId === "string" && "text" in raw && typeof raw.text === "string" && "truncated" in raw && typeof raw.truncated === "boolean" ? { kind: raw.kind, callId: raw.callId, text: raw.text, truncated: raw.truncated } : null;
    case "tool_finish": return "callId" in raw && typeof raw.callId === "string" && "status" in raw && (raw.status === "ok" || raw.status === "error") && "durationMs" in raw && typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs >= 0 ? { kind: raw.kind, callId: raw.callId, status: raw.status, durationMs: raw.durationMs } : null;
    case "tool_detail": return "callId" in raw && typeof raw.callId === "string" && "args" in raw && typeof raw.args === "string" && "text" in raw && typeof raw.text === "string" && "truncated" in raw && typeof raw.truncated === "boolean" ? { kind: raw.kind, callId: raw.callId, args: raw.args, text: raw.text, truncated: raw.truncated } : null;
    default: return null;
  }
}

export function parseReplyParts(raw: unknown): ReplyPart[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ReplyPart[] = [];
  for (const item of raw) { const part = parseReplyPart(item); if (!part) return undefined; out.push(part); }
  return out;
}
