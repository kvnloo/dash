import { createStore } from "./createStore";
import type { GateItem } from "../../../shared/gate";
import type { GateServerMessage } from "../../../shared/protocol";
interface ApprovalsState { items: GateItem[]; dryRun: boolean; ownerDecisions: boolean; loaded: boolean; error: string | null; status: Record<string, string> }
export const approvals = createStore<ApprovalsState>({ items: [], dryRun: true, ownerDecisions: false, loaded: false, error: null, status: {} });
export function applyGateMessage(m: GateServerMessage) {
  approvals.set(s => {
    if (m.type === "gate_snapshot") return { ...s, items: m.items, dryRun: m.dry_run, ownerDecisions: m.owner_decisions === true, loaded: true, error: null, status: {} };
    if (m.type === "gate_error") return { ...s, error: m.message };
    return { ...s, status: { ...s.status, [m.id]: m.message }, error: null };
  });
}
export const actionable = (i: GateItem) => i.state === "pending" || i.state === "edited";
export const bulkEligible = (i: GateItem) => actionable(i) && i.policy.bulk_ok && !i.policy.requires_human_text;

const KIND_TITLE: Record<GateItem["kind"], string> = {
  issue_comment: "Comment on issue", pr_comment: "Comment on pull request", pr_review_reply: "Reply to a review comment",
  pr_open: "Open pull request", pr_ready_for_review: "Mark ready for review", push_branch: "Push branch",
};
/** Cards always lead with what the action is, even when the target has no title. */
export function itemTitle(item: Pick<GateItem, "kind" | "target">): string {
  return item.target.title?.trim() || KIND_TITLE[item.kind];
}
