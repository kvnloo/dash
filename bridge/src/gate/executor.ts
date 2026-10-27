import type { GateItem } from "../../../shared/gate";
import { derivePolicy, GateStore, hash, type Rule } from "./store";
export interface GateRemote {
  rules(repo: string): Promise<Rule[]>;
  check(item: GateItem): Promise<string>;
  post(item: GateItem): Promise<string>;
  verify(item: GateItem, url: string): Promise<boolean>;
  authorized?(item: GateItem): Promise<boolean>;
}
export class GateExecutor {
  constructor(readonly store: GateStore, readonly remote: GateRemote) {}
  async post(id: string, dryRun: boolean, status?: (text: string) => void): Promise<GateItem> {
    // Cross-process lock spans live checks and the write. A crash after attempt is fail-closed.
    return this.store.locked(async () => {
      let i = await this.store.show(id);
      if (i.state !== "approved") throw new Error("Only approved items may execute");
      if (!dryRun && (!i.authorization || (!Number.isFinite(Date.parse(i.authorization.expires_at)) || Date.parse(i.authorization.expires_at) <= Date.now()) || i.authorization.body_sha256 !== hash(i.body))) throw new Error("A current canonical human decision receipt is required for live execution");
      const approval = i.trail.at(-1);
      if (approval?.action !== "approve" && approval?.action !== "dry_run") throw new Error("Missing owner approval");
      const approved = i.trail.findLast(t => t.action === "approve" && t.actor === "dash-owner");
      if (!approved || approved.body_sha256 !== hash(i.body)) throw new Error("Body changed since approval");
      if (i.policy.requires_human_text && !i.trail.some(t => t.actor === "dash-owner" && t.action === "edit" && t.body_sha256 === hash(i.body))) throw new Error("Owner must write text in Dash");
      if (!dryRun && (!this.remote.authorized || !await this.remote.authorized(i))) throw new Error("Canonical approval was revoked, changed, expired or cannot be verified");
      status?.("Checking live target…");
      try {
        const policy = derivePolicy(await this.remote.rules(i.target.repo));
        const reason = policy.rules.length === 0 ? "Target contribution rules unavailable" : JSON.stringify(policy) !== JSON.stringify(i.policy) ? "Target contribution rules changed; re-propose for fresh review" : await this.remote.check(i);
        if (reason) return this.store.save({ ...i, state: "stale", reason }, "stale", "executor", reason);
        if (dryRun) return this.store.save({ ...i, receipt: { dry_run: true, at: new Date().toISOString() } }, "dry_run", "executor", "Live checks passed; nothing posted");
        // Persist the attempt before network mutation. Ambiguous failures never auto-retry.
        i = this.store.save({ ...i, state: "failed", reason: "Posting attempt started; reconcile remote state before any retry" }, "post_attempt", "executor");
        status?.("Posting…");
        const url = await this.remote.post(i);
        if (!await this.remote.verify(i, url)) throw new Error("Post returned but exact target readback did not match; reconcile manually");
        return this.store.save({ ...i, state: "posted", reason: undefined, receipt: { url, dry_run: false, at: new Date().toISOString() } }, "posted", "executor");
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Remote operation failed";
        return this.store.save({ ...i, state: "failed", reason }, "failed", "executor", reason);
      }
    });
  }
}
