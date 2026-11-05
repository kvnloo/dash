// Surface-neutral upstream action contract. No host or React dependencies.
export const GATE_KINDS = ["issue_comment", "pr_comment", "pr_review_reply", "pr_open", "pr_ready_for_review", "push_branch"] as const;
export const GATE_STATES = ["pending", "approved", "rejected", "edited", "posted", "failed", "stale"] as const;
export interface GateProposal {
  kind: typeof GATE_KINDS[number];
  target: { repo: string; number?: number; head_sha?: string; base?: string; head?: string; title?: string; comment_id?: number };
  body: string;
  intent?: "new_contribution" | "existing_review";
  evidence: { label: string; url_or_path: string }[];
  origin: { agent: string; session: string; created_at: string };
}
export interface GatePolicy {
  bulk_ok: boolean;
  requires_human_text: boolean;
  reason: string;
  rules: { path: string; sha256: string }[];
}
export interface GateEvent {
  at: string; actor: string; action: string; reason?: string; body_sha256: string;
}
export interface GateItem extends GateProposal {
  id: string;
  policy: GatePolicy;
  state: typeof GATE_STATES[number];
  trail: GateEvent[];
  receipt?: { url?: string; dry_run: boolean; at: string };
  reason?: string;
  authorization?: { url: string; approved_by: string; expires_at: string; body_sha256: string; scope: string; receipt_sha256?: string };
}
export type GateDecision =
  | { action: "approve"; ids: string[]; expected?: { id: string; body_sha256: string }[] }
  | { action: "reject"; id: string; reason: string }
  | { action: "edit"; id: string; body: string };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const optionalText = (v: unknown) => v === undefined || text(v);
const optionalNumber = (v: unknown) => v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v > 0);
export function isGateProposal(v: unknown): v is GateProposal {
  return record(v) && GATE_KINDS.some(k => k === v.kind) && record(v.target) && text(v.target.repo) &&
    /^[\w.-]+\/[\w.-]+$/.test(v.target.repo) && optionalNumber(v.target.number) && optionalNumber(v.target.comment_id) &&
    optionalText(v.target.head_sha) && (v.target.head_sha === undefined || (text(v.target.head_sha) && /^[a-f0-9]{40}$/.test(v.target.head_sha))) &&
    optionalText(v.target.base) && optionalText(v.target.head) && optionalText(v.target.title) &&
    (v.intent === undefined || v.intent === "new_contribution" || v.intent === "existing_review") && text(v.body) && v.body.length <= 60000 && Array.isArray(v.evidence) && v.evidence.length > 0 &&
    v.evidence.every(e => record(e) && text(e.label) && text(e.url_or_path)) && record(v.origin) &&
    text(v.origin.agent) && v.origin.agent.length > 0 && text(v.origin.session) && text(v.origin.created_at) && Number.isFinite(Date.parse(v.origin.created_at));
}
export function isGateItem(v: unknown): v is GateItem {
  return isGateProposal(v) && record(v) && text(v.id) && /^[a-f0-9-]{36}$/.test(v.id) &&
    GATE_STATES.some(s => s === v.state) && record(v.policy) && typeof v.policy.bulk_ok === "boolean" &&
    typeof v.policy.requires_human_text === "boolean" && text(v.policy.reason) && Array.isArray(v.policy.rules) &&
    v.policy.rules.every(r => record(r) && text(r.path) && text(r.sha256)) && Array.isArray(v.trail) &&
    v.trail.every(e => record(e) && text(e.at) && text(e.actor) && text(e.action) && text(e.body_sha256) && optionalText(e.reason)) &&
    (v.authorization === undefined || (record(v.authorization) && text(v.authorization.url) && text(v.authorization.approved_by) && text(v.authorization.expires_at) && text(v.authorization.body_sha256) && text(v.authorization.scope) && optionalText(v.authorization.receipt_sha256))) &&
    optionalText(v.reason) && (v.receipt === undefined || (record(v.receipt) && optionalText(v.receipt.url) && typeof v.receipt.dry_run === "boolean" && text(v.receipt.at)));
}
export function parseGateDecision(v: unknown): GateDecision | null {
  if (!record(v)) return null;
  const id = (s: unknown): s is string => text(s) && /^[a-f0-9-]{36}$/.test(s);
  if (v.action === "approve" && Array.isArray(v.ids) && v.ids.length > 0 && v.ids.length <= 100 && v.ids.every(id) && new Set(v.ids).size === v.ids.length) {
    if (v.expected === undefined) return { action: "approve", ids: v.ids };
    if (!Array.isArray(v.expected) || v.expected.length !== v.ids.length || !v.expected.every(e => record(e) && id(e.id) && text(e.body_sha256) && /^[a-f0-9]{64}$/.test(e.body_sha256))) return null;
    return { action: "approve", ids: v.ids, expected: v.expected };
  }
  if (v.action === "reject" && id(v.id) && text(v.reason) && v.reason.trim().length > 0 && v.reason.length <= 2000) return { action: "reject", id: v.id, reason: v.reason };
  if (v.action === "edit" && id(v.id) && text(v.body) && v.body.trim().length > 0 && v.body.length <= 60000) return { action: "edit", id: v.id, body: v.body };
  return null;
}
