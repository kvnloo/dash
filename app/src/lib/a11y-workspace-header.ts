import { TAB_LABELS, clampTab } from "../components/golden-nav";

/** The heading identifies the visible pane; the pager, not this heading, changes tabs. */
export function workspaceHeadingLabel(tab: number): string {
  return `${TAB_LABELS[clampTab(tab)]} workspace`;
}

/** These labels describe the existing actions, not a second navigation mechanism. */
export const WORKSPACE_ACTION_LABELS = {
  roadmap: "Open roadmap",
  trace: "Open event trace",
  newChat: "Create new chat",
  settings: "Open settings",
};

export interface UpstreamApprovalAction {
  readonly label: string;
  readonly hint: string;
  readonly badgeText: string;
}

/**
 * This is the existing upstream publication GateItem queue, not ACP session
 * permissions ("needs OK"). Keep the spoken count exact even when the visual
 * badge abbreviates counts above 99.
 */
export function upstreamApprovalAction(pending: number): UpstreamApprovalAction | null {
  if (!Number.isSafeInteger(pending) || pending <= 0) return null;
  return {
    label: `Upstream approvals, ${pending} pending`,
    hint: "Review pending upstream action approvals",
    badgeText: pending > 99 ? "99+" : String(pending),
  };
}
