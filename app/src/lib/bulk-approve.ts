// Bulk approve from Quick mode (A12: "if 10 comments are ready to post, then i can approve them in
// bulk"). Pure selection only; the screens send. Two kinds of approval exist and neither is widened:
// - ACP permission requests (Needs OK): only pending, unexpired, connected requests that offer an
//   allow_once option; each gets its own exact decision. Never allow_always.
// - Upstream gate items: only bulk-safe items (policy-checked, no human text) and only their exact
//   current bodies (expected sha256), the same decision the Approvals screen sends.
import type { GateDecision, GateItem } from "../../../shared/gate";

type Kind = "allow_once" | "allow_always" | "reject_once" | "reject_always";
export interface PermissionCandidate {
  conversationId: string; sessionId: string; turnId: string; requestId: string;
  readonly options: readonly { optionId: string; kind: Kind }[];
  readonly phase: string; readonly deadlineAt: number; readonly error: string | null;
}
export interface PermissionChoice { scope: { conversationId: string; sessionId: string; turnId: string; requestId: string }; optionId: string }

export function bulkPermissionChoices(records: readonly PermissionCandidate[], now: number): PermissionChoice[] {
  const out: PermissionChoice[] = [];
  for (const r of records) {
    if (r.phase !== "pending" || now >= r.deadlineAt || r.error === "disconnected") continue;
    const once = r.options.find(o => o.kind === "allow_once");
    if (!once) continue;
    out.push({ scope: { conversationId: r.conversationId, sessionId: r.sessionId, turnId: r.turnId, requestId: r.requestId }, optionId: once.optionId });
  }
  return out;
}

const SHA = /^[a-f0-9]{64}$/;
type Bulkable = Pick<GateItem, "id" | "state" | "policy" | "trail">;
export function bulkSafeGateItems<T extends Bulkable>(items: readonly T[]): T[] {
  return items.filter(i => (i.state === "pending" || i.state === "edited") && i.policy.bulk_ok && !i.policy.requires_human_text && SHA.test(i.trail.at(-1)?.body_sha256 ?? ""));
}

/** One approve decision for exactly these bodies, or null when nothing is bulk-safe. */
export function bulkGateDecision(items: readonly Bulkable[]): GateDecision | null {
  const safe = bulkSafeGateItems(items).slice(0, 100);
  if (!safe.length) return null;
  return { action: "approve", ids: safe.map(i => i.id), expected: safe.map(i => ({ id: i.id, body_sha256: i.trail.at(-1)?.body_sha256 ?? "" })) };
}
