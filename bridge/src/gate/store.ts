import { stripMentions, toneFailure } from "./factory";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isGateItem, isGateProposal, parseGateDecision, type GateItem, type GatePolicy, type GateProposal, type GateDecision } from "../../../shared/gate";
export const CANONICAL_GATE = "/mnt/zer0models/workspace/zer0/data/operations/upstream-gate";
export interface Rule { path: string; text: string }
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function derivePolicy(rules: Rule[]): GatePolicy {
  const content = rules.map(r => r.text).join("\n");
  const human = /no\s+(?:ai|llm)[-\s]*(?:generated|written)|human[- ](?:written|authored)|(?:write|respond).{0,50}(?:your own words|yourself)|(?:human|humans)\s+must\s+(?:write|author)|(?:comments|responses).{0,50}(?:by a human|not.{0,10}ai)|AI[- ]generated.{0,35}(?:denied|forbidden|not allowed)/i.test(content);
  const individual = /\bCLA\b|\bDCO\b|sign[- ]off|vouch|issues[- ]first|ready-for-pr/i.test(content);
  return { bulk_ok: rules.length > 0 && !human && !individual, requires_human_text: human,
    reason: human ? "Target rules require human-written text. Write your own response; generated text is withheld." : individual ? "Target has CLA/DCO, vouch or scope requirements. Review individually; approval does not attest legal compliance." : rules.length ? "Contribution rules captured. Review evidence before approval." : "Contribution rules unavailable. Individual review required; posting blocked until rules are captured.",
    rules: rules.map(r => ({ path: r.path, sha256: hash(r.text) })) };
}
export class GateStore {
  constructor(readonly root = CANONICAL_GATE) { mkdirSync(join(root, "outbox"), { recursive: true, mode: 0o700 }); }
  private path(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid gate id"); return join(this.root, "outbox", `${id}.json`); }
  list(): GateItem[] {
    // The append-only journal is authoritative. Replay also repairs interrupted snapshot writes.
    let journal = "";
    try { journal = readFileSync(join(this.root, "events.jsonl"), "utf8"); } catch (e) { if (!isMissing(e)) throw e; }
    const entries = new Map<string, GateItem>();
    for (const line of journal.split("\n")) {
      if (!line) continue;
      const raw: unknown = JSON.parse(line);
      if (!isGateItem(raw)) throw new Error("Corrupt gate journal; manual recovery required");
      entries.set(raw.id, raw);
    }
    return [...entries.values()].sort((a,b) => a.origin.created_at.localeCompare(b.origin.created_at));
  }
  async show(id: string): Promise<GateItem> { this.path(id); const item = this.list().find(i => i.id === id); if (!item) throw new Error("Unknown gate item"); return item; }
  async locked<T>(work: () => Promise<T>): Promise<T> {
    const lock = join(this.root, ".writer-lock");
    for (let n = 0; ; n++) {
      try { mkdirSync(lock, { mode: 0o700 }); break; } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "EEXIST") || n >= 500) throw new Error("Gate busy; retry later (an abandoned lock needs operator recovery)");
        await Bun.sleep(20);
      }
    }
    try { return await work(); } finally { rmSync(lock, { recursive: true }); }
  }
  save(item: GateItem, action: string, actor: string, reason?: string): GateItem {
    const next: GateItem = { ...item, trail: [...item.trail, { at: new Date().toISOString(), actor, action, reason, body_sha256: hash(item.body) }] };
    // fsync journal before replacing the materialized record. Never rewrite the journal.
    appendFileSync(join(this.root, "events.jsonl"), JSON.stringify(next) + "\n", { mode: 0o600, flush: true });
    const dest = this.path(next.id), temp = `${dest}.next`;
    writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flush: true });
    renameSync(temp, dest);
    return next;
  }
  async propose(raw: unknown, rules: Rule[]): Promise<GateItem> {
    if (!isGateProposal(raw) || raw.origin.agent === "dash-owner") throw new Error("Invalid proposal");
    const input: GateProposal = raw;
    return this.locked(async () => {
      const policy = derivePolicy(rules);
      const body = policy.requires_human_text ? "" : stripMentions(input.body);
      const existing = this.list().find(i => i.kind === input.kind && JSON.stringify(i.target) === JSON.stringify(input.target) && i.body === body && i.state !== "rejected");
      if (existing) return existing;
      return this.save({ ...input, body, id: randomUUID(), policy, state: "pending", trail: [] }, "propose", input.origin.agent);
    });
  }
  async decide(raw: GateDecision, actor: string, authorizations: Record<string, NonNullable<GateItem["authorization"]>> = {}): Promise<GateItem[]> {
    if (actor !== "dash-owner") throw new Error("Only the authenticated Dash owner can decide; agent CLI approval is forbidden");
    const decision = parseGateDecision(raw);
    if (!decision) throw new Error("Invalid gate decision");
    return this.locked(async () => {
      const ids = decision.action === "approve" ? decision.ids : [decision.id];
      const items = await Promise.all(ids.map(id => this.show(id)));
      for (const item of items) {
        if (!["pending", "edited", "approved"].includes(item.state)) throw new Error(`${item.state} items cannot be decided; propose a fresh item`);
        if (decision.action === "approve") {
          const receipt = authorizations[item.id];
          if (receipt && receipt.body_sha256 !== hash(item.body)) throw new Error("Proposal changed while recording canonical approval");
          const tone = toneFailure(item.body);
          if (tone || stripMentions(item.body) !== item.body) throw new Error(tone || "Remove account mentions before approval");
          if (ids.length > 1 && !item.policy.bulk_ok) throw new Error("Bulk approval is not allowed for this policy");
          if (!item.body.trim() || (item.policy.requires_human_text && !item.trail.some(t => t.action === "edit" && t.actor === actor && t.body_sha256 === hash(item.body)))) throw new Error("Owner must write text in Dash before approving");
        }
        if (decision.action === "edit" && decision.body === item.body) throw new Error("Owner must change the text");
      }
      return items.map(item => {
        if (decision.action === "edit") return this.save({ ...item, body: stripMentions(decision.body), state: "edited", receipt: undefined, authorization: undefined }, "edit", actor);
        if (decision.action === "reject") return this.save({ ...item, state: "rejected", reason: decision.reason }, "reject", actor, decision.reason);
        return this.save({ ...item, state: "approved", authorization: authorizations[item.id] }, "approve", actor);
      });
    });
  }
  async stale(id: string, reason: string): Promise<GateItem> {
    return this.locked(async () => { const i = await this.show(id); if (i.state === "posted") throw new Error("Posted receipt is immutable"); return this.save({ ...i, state: "stale", reason }, "stale", "validator", reason); });
  }
}
function isMissing(e: unknown) { return e instanceof Error && "code" in e && e.code === "ENOENT"; }
