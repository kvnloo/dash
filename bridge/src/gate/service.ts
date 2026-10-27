import { FactoryGuard } from "./factory";
import { hash } from "./store";
import type { GateItem } from "../../../shared/gate";
import type { GateClientMessage, GateServerMessage } from "../../../shared/protocol";
import { GateStore } from "./store";
import { GateExecutor } from "./executor";
import { GitHubRemote } from "./github";

export class GateService {
  private readonly listeners = new Set<(m: GateServerMessage) => void>();
  private previous = "";
  private queue: Promise<void> = Promise.resolve();
  private readonly executor: GateExecutor;
  constructor(readonly store: GateStore, readonly dryRun = true, remote = new GitHubRemote(), readonly ownerDecisions = false) { this.executor = new GateExecutor(store, remote); }
  unsubscribe(send: (m: GateServerMessage) => void) { this.listeners.delete(send); }
  refresh() {
    const items = this.store.list(), signature = JSON.stringify(items);
    if (signature === this.previous) return;
    this.previous = signature;
    for (const send of this.listeners) send({ type: "gate_snapshot", items, dry_run: this.dryRun, owner_decisions: this.ownerDecisions });
  }
  handle(message: GateClientMessage, send: (m: GateServerMessage) => void): Promise<void> {
    const task = this.queue.then(() => this.process(message, send));
    this.queue = task.catch(() => {});
    return task;
  }
  private async process(message: GateClientMessage, send: (m: GateServerMessage) => void) {
    try {
      if (message.type === "gate_list") {
        this.listeners.add(send);
        send({ type: "gate_snapshot", items: this.store.list(), dry_run: this.dryRun, owner_decisions: this.ownerDecisions });
      } else if (message.type === "gate_decide") {
        if (message.decision.action !== "approve" && this.ownerDecisions) {
          const previous = await this.store.show(message.decision.id);
          if (previous.authorization) await new FactoryGuard().revoke(previous);
        }
        const receipts: Record<string, NonNullable<GateItem["authorization"]>> = {};
        if (message.decision.action === "approve" && this.ownerDecisions) {
          if (!message.decision.expected) throw new Error("Owner must confirm the exact displayed bodies");
          const guard = new FactoryGuard();
          const candidates = await Promise.all(message.decision.ids.map(id => this.store.show(id)));
          // Validate the entire wave before emitting any canonical human-decision receipt.
          for (const item of candidates) {
            if (message.decision.expected.find(e => e.id === item.id)?.body_sha256 !== hash(item.body)) throw new Error("Body changed since confirmation");
            if (!["pending", "edited"].includes(item.state)) throw new Error("Only pending or edited proposals can be approved");
            if (candidates.length > 1 && !item.policy.bulk_ok) throw new Error("Bulk policy forbids this wave");
            if (!item.body.trim() || (item.policy.requires_human_text && !item.trail.some(e => e.action === "edit" && e.actor === "dash-owner" && e.body_sha256 === hash(item.body)))) throw new Error("Owner must write text before approval");
            await guard.preflight(item);
          }
          for (const item of candidates) receipts[item.id] = await guard.record(item, {
            approved_by: "Kevin Rajan via paired Dash", expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            body_sha256: hash(item.body), scope: `Only ${item.kind} on ${JSON.stringify(item.target)}; exact reviewed body; one execution; expires in 24 hours. Owner attests peer tone, smallest ask, self-service, local voice, scope and current feedback review.`,
          });
        }
        await this.store.decide(message.decision, "dash-owner", receipts);
        this.refresh();
      } else {
        await this.executor.post(message.id, this.dryRun, text => {
          for (const listener of this.listeners) listener({ type: "gate_status", id: message.id, message: text });
        });
        this.refresh();
      }
    } catch (e) { send({ type: "gate_error", message: e instanceof Error ? e.message : "Approval gate failed" }); }
  }
}
