import type { ReplyPart } from "../../shared/protocol";
import { cap, redact, PREVIEW_BYTES, DETAIL_BYTES } from "./reply-parts";

/** Bounded per-turn cache, owned by the same replay/auth lifetime as the turn. */
export class ToolDetails {
  private calls = new Map<string, { args: string; text: string; truncated: boolean; sent: number }>();
  private bytes = 0;
  preview(part: ReplyPart): ReplyPart | null {
    if (part.kind === "reasoning") return { ...part, text: cap(redact(part.text), PREVIEW_BYTES) };
    if (part.kind === "tool_start") {
      const previous = this.calls.get(part.callId);
      if (!previous && this.calls.size >= 128) return null;
      if (previous) this.bytes -= new TextEncoder().encode(previous.args).length;
      const args = cap(redact(part.args), Math.max(0, DETAIL_BYTES - this.bytes));
      this.bytes += new TextEncoder().encode(args).length;
      this.calls.set(part.callId, { args, text: previous?.text ?? "", truncated: args !== redact(part.args) || (previous?.truncated ?? false), sent: previous?.sent ?? 0 });
      return { ...part, name: redact(part.name), summary: redact(part.summary), args: cap(args, PREVIEW_BYTES), truncated: args !== cap(args, PREVIEW_BYTES) };
    }
    const call = this.calls.get(part.callId);
    if (!call) return null;
    if (part.kind !== "tool_output") return part;
    const clean = redact(part.text);
    const retained = cap(clean, Math.max(0, DETAIL_BYTES - this.bytes));
    this.bytes += new TextEncoder().encode(retained).length;
    call.text += retained;
    call.truncated ||= retained !== clean || part.truncated;
    const text = cap(retained, Math.max(0, PREVIEW_BYTES - call.sent));
    call.sent += new TextEncoder().encode(text).length;
    return { ...part, text, truncated: call.truncated || text !== retained };
  }
  get(callId: string): ReplyPart | undefined {
    const call = this.calls.get(callId);
    return call ? { kind: "tool_detail", callId, args: call.args, text: call.text, truncated: call.truncated } : undefined;
  }
}
