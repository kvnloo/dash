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
