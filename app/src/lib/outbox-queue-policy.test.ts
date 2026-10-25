import { describe, expect, test } from "bun:test";
import type { ChatAttachment } from "../../../shared/protocol";
import {
  createOutboxQueueItem,
  planQueueCombine,
  planQueueEdit,
  planQueueRemove,
  planQueueReorder,
  queueBatchId,
  snapshotForAdmission,
  type OutboxQueueItem,
  type QueueBlockReason,
  type QueueBlockResolution,
  type QueueDeliveryPhase,
  type QueueIntent,
  type QueuePlan,
  type QueueTarget,
} from "./outbox-queue-policy";

const target: QueueTarget = {
  conversationId: "conversation-1",
  harness: "hermes",
  hostId: "host-a",
  profileId: "hermes:default",
  sessionId: "session-a",
  cwd: "/workspace",
};

function file(id: string): ChatAttachment {
  return { id: id.repeat(32), name: id + ".txt", mime: "text/plain", size: 42 };
}

function entry(
  clientId: string,
  options: {
    text?: string;
    intent?: QueueIntent;
    phase?: QueueDeliveryPhase;
    target?: QueueTarget;
    attachments?: readonly ChatAttachment[];
  } = {},
): OutboxQueueItem {
  return {
    ...createOutboxQueueItem({
      clientId,
      turnId: "turn-" + clientId,
      target: options.target ?? target,
      intent: options.intent ?? "queue",
      text: options.text ?? "Message " + clientId,
      attachments: options.attachments,
    }),
    phase: options.phase ?? "queued",
  };
}

function allowed(plan: QueuePlan): readonly OutboxQueueItem[] {
  expect(plan.allowed).toBe(true);
  if (!plan.allowed) throw new Error("Unexpected queue block: " + plan.reason);
  return plan.items;
}

function blocked(
  plan: QueuePlan,
  reason: QueueBlockReason,
  original: readonly OutboxQueueItem[],
  resolution: QueueBlockResolution = "correct-input",
): void {
  expect(plan.allowed).toBe(false);
  if (plan.allowed) throw new Error("Expected a queue block");
  expect(plan.reason).toBe(reason);
  expect(plan.resolution).toBe(resolution);
  expect(plan.items).toBe(original);
}

describe("outbox queued-turn policy", () => {
  test("new queued entries snapshot the target/files and record source identities", () => {
    const attachment = file("a");
    const originalTarget = { ...target };
    const draft = createOutboxQueueItem({
      clientId: "a", turnId: "turn-a", intent: "queue", target: originalTarget,
      text: "original", attachments: [attachment],
    });
    attachment.name = "changed.txt";
    originalTarget.sessionId = "replaced";
    expect(draft.target).toEqual(target);
    expect(draft.attachments).toEqual([file("a")]);
    expect(draft.sourceClientIds).toEqual(["a"]);
    expect(draft.sourceTurnIds).toEqual(["turn-a"]);
    expect(draft.phase).toBe("queued");
    expect(draft.batchId).toBeUndefined();
  });

  test("queued edit preserves clientId, turnId, mode, target and attachment metadata", () => {
    const a = entry("a", { attachments: [file("a")] });
    const b = entry("b");
    const original = [a, b];
    const next = allowed(planQueueEdit(original, "a", "Rewritten"));
    expect(next[0]).toEqual({ ...a, text: "Rewritten" });
    expect(next[1]).toBe(b);
    expect(a.text).toBe("Message a");
    expect(next[0]?.sourceClientIds).toEqual(["a"]);
    expect(next[0]?.sourceTurnIds).toEqual(["turn-a"]);
    expect(next[0]?.attachments).toEqual([file("a")]);
    expect(allowed(planQueueEdit(original, "a", a.text))).toBe(original);
  });

  test("attachment-only drafts can be edited to empty text; empty drafts are blocked", () => {
    const attachmentOnly = [entry("a", { attachments: [file("a")] })];
    expect(allowed(planQueueEdit(attachmentOnly, "a", ""))[0]?.text).toBe("");
    const noFiles = [entry("b")];
    blocked(planQueueEdit(noFiles, "b", "   "), "empty-payload", noFiles);
    blocked(planQueueEdit(noFiles, "missing", "edit"), "not-found", noFiles);
  });

  test("unsent reorder moves complete entries, keeping attachments and all ids", () => {
    const a = entry("a", { attachments: [file("a")] });
    const b = entry("b", { attachments: [file("b")] });
    const c = entry("c", { attachments: [file("c")] });
    const original = [a, b, c];
    const reordered = allowed(planQueueReorder(original, 2, 0));
    expect(reordered).toEqual([c, a, b]);
    expect(reordered.map(item => item.turnId)).toEqual(["turn-c", "turn-a", "turn-b"]);
    expect(reordered.flatMap(item => item.attachments.map(att => att.id))).toEqual([file("c").id, file("a").id, file("b").id]);
    expect(original).toEqual([a, b, c]);
    expect(allowed(planQueueReorder(original, 1, 1))).toBe(original);
    for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0.2, 1], [1, Infinity]]) {
      blocked(planQueueReorder(original, from, to), "invalid-position", original);
    }
  });

  test("pre-admission combine preserves first transport ids, ordered originals, and files", () => {
    const a = entry("a", { attachments: [file("a")] });
    const b = entry("b", { attachments: [file("b")] });
    const c = entry("c");
    const source = [a, b, c];
    const combined = allowed(planQueueCombine(source, ["b", "a"]));
    expect(combined).toHaveLength(2);
    const batch = combined[0];
    expect(batch?.clientId).toBe("a");
    expect(batch?.turnId).toBe("turn-a");
    expect(batch?.batchId).toBe(queueBatchId(["a", "b"]));
    expect(batch?.sourceClientIds).toEqual(["a", "b"]);
    expect(batch?.sourceTurnIds).toEqual(["turn-a", "turn-b"]);
    expect(batch?.text).toBe("Message a\n\nMessage b");
    expect(batch?.attachments).toEqual([file("a"), file("b")]);
    expect(batch?.intent).toBe("queue");
    expect(batch?.target).toEqual(target);
    expect(combined[1]).toBe(c);
    expect(source).toEqual([a, b, c]);
    expect(source[0]?.attachments).toEqual([file("a")]);
  });

  test("batch IDs and full provenance survive edits and ordinary reorders", () => {
    const a = entry("a", { attachments: [file("a")] });
    const b = entry("b", { attachments: [file("b")] });
    const c = entry("c", { attachments: [file("c")] });
    const first = allowed(planQueueCombine([a, b, c], ["a", "b"]));
    const edited = allowed(planQueueEdit(first, "a", "Edited batch"));
    expect(edited[0]?.batchId).toBe(queueBatchId(["a", "b"]));
    expect(edited[0]?.sourceClientIds).toEqual(["a", "b"]);
    const reordered = allowed(planQueueReorder(edited, 0, 1));
    expect(reordered.map(item => item.clientId)).toEqual(["c", "a"]);
    expect(reordered[1]?.batchId).toBe(queueBatchId(["a", "b"]));
    const expanded = allowed(planQueueCombine(reordered, ["a", "c"], "Explicit preview"));
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.clientId).toBe("c");
    expect(expanded[0]?.turnId).toBe("turn-c");
    expect(expanded[0]?.sourceClientIds).toEqual(["c", "a", "b"]);
    expect(expanded[0]?.sourceTurnIds).toEqual(["turn-c", "turn-a", "turn-b"]);
    expect(expanded[0]?.attachments).toEqual([file("c"), file("a"), file("b")]);
    expect(expanded[0]?.text).toBe("Explicit preview");
    expect(expanded[0]?.batchId).toBe(queueBatchId(["c", "a", "b"]));
  });

  test("combined source IDs cannot be separately edited or discarded", () => {
    const combined = allowed(planQueueCombine([entry("a"), entry("b")], ["a", "b"]));
    blocked(planQueueEdit(combined, "b", "mutated"), "source-in-batch", combined);
    blocked(planQueueRemove(combined, "b"), "source-in-batch", combined);
    expect(allowed(planQueueRemove(combined, "a"))).toEqual([]);
  });

  test("combine refuses noncontiguous selections and empty/malformed selections", () => {
    const originals = [entry("a"), entry("b"), entry("c")];
    blocked(planQueueCombine(originals, ["a", "c"]), "noncontiguous-selection", originals);
    blocked(planQueueCombine(originals, ["a"]), "invalid-selection", originals);
    blocked(planQueueCombine(originals, ["a", "a"]), "invalid-selection", originals);
    blocked(planQueueCombine(originals, ["a", "absent"]), "not-found", originals);
    blocked(planQueueCombine(originals, ["a", "b"], "  "), "empty-payload", originals);
    expect(originals.map(item => item.turnId)).toEqual(["turn-a", "turn-b", "turn-c"]);
  });

  test("combine enforces attachment limit without dropping any reference", () => {
    const five = entry("a", { attachments: Array.from({ length: 5 }, () => file("a")) });
    const four = entry("b", { attachments: Array.from({ length: 4 }, () => file("b")) });
    const nine = [five, four];
    blocked(planQueueCombine(nine, ["a", "b"]), "attachment-limit", nine);
    const eight = [five, entry("b", { attachments: Array.from({ length: 3 }, () => file("b")) })];
    expect(allowed(planQueueCombine(eight, ["a", "b"]))[0]?.attachments).toHaveLength(8);
  });

  test("steer and normal queue never combine or reorder across each other", () => {
    const queue = entry("a");
    const steer = entry("b", { intent: "steer" });
    const mixed = [queue, steer];
    blocked(planQueueCombine(mixed, ["a", "b"]), "mixed-intent", mixed);
    blocked(planQueueReorder(mixed, 0, 1), "mixed-intent", mixed);
    blocked(planQueueReorder(mixed, 1, 0), "mixed-intent", mixed);
    const steers = [steer, entry("c", { intent: "steer" })];
    blocked(planQueueCombine(steers, ["b", "c"]), "steer-not-combinable", steers);
    expect(allowed(planQueueEdit(steers, "b", "new steer"))[0]?.intent).toBe("steer");
  });

  test("session, host, profile, cwd and conversation routing never merge", () => {
    const a = entry("a");
    const variants: QueueTarget[] = [
      { ...target, sessionId: "other" },
      { ...target, hostId: "other" },
      { ...target, profileId: "other" },
      { ...target, cwd: "/other" },
      { ...target, conversationId: "other" },
      { ...target, harness: "codex" },
    ];
    for (const destination of variants) {
      const pair = [a, entry("b", { target: destination })];
      blocked(planQueueCombine(pair, ["a", "b"]), "target-mismatch", pair);
      blocked(planQueueReorder(pair, 0, 1), "target-mismatch", pair);
    }
  });

  test("a sent but unconfirmed turn requires reconciliation for every mutation", () => {
    const sent = entry("a", { phase: "sent", attachments: [file("a")] });
    const waiting = entry("b");
    const queue = [sent, waiting];
    blocked(planQueueEdit(queue, "a", "changed"), "sent-unconfirmed", queue, "reconcile");
    blocked(planQueueRemove(queue, "a"), "sent-unconfirmed", queue, "reconcile");
    blocked(planQueueReorder(queue, 0, 1), "sent-unconfirmed", queue, "reconcile");
    blocked(planQueueReorder(queue, 1, 0), "sent-unconfirmed", queue, "reconcile");
    blocked(planQueueCombine(queue, ["a", "b"]), "sent-unconfirmed", queue, "reconcile");
    expect(queue[0]).toBe(sent);
    expect(sent.clientId).toBe("a");
    expect(sent.turnId).toBe("turn-a");
    expect(sent.attachments).toEqual([file("a")]);
  });

  test("acked and started work is immutable; removing an unsent neighbor retains it", () => {
    const phases: QueueDeliveryPhase[] = ["acked-by-bridge", "started"];
    for (const phase of phases) {
      const admitted = entry("a", { phase });
      const pending = entry("b");
      const queue = [admitted, pending];
      blocked(planQueueEdit(queue, "a", "replacement"), "already-admitted", queue, "retain-admitted");
      blocked(planQueueRemove(queue, "a"), "already-admitted", queue, "retain-admitted");
      blocked(planQueueCombine(queue, ["a", "b"]), "already-admitted", queue, "retain-admitted");
      const afterRemove = allowed(planQueueRemove(queue, "b"));
      expect(afterRemove).toEqual([admitted]);
      expect(afterRemove[0]).toBe(admitted);
    }
  });

  test("reorder respects admitted fences but permits queued neighbors", () => {
    const pendingA = entry("a");
    const pendingB = entry("b");
    const admitted = entry("c", { phase: "acked-by-bridge" });
    const pendingD = entry("d");
    const queue = [pendingA, pendingB, admitted, pendingD];
    expect(allowed(planQueueReorder(queue, 0, 1))).toEqual([pendingB, pendingA, admitted, pendingD]);
    blocked(planQueueReorder(queue, 0, 3), "already-admitted", queue, "retain-admitted");
    blocked(planQueueReorder(queue, 3, 1), "already-admitted", queue, "retain-admitted");
  });

  test("duplicated source or active transport identities cannot be sent as a batch", () => {
    const a = entry("a");
    const b = entry("b");
    const dupSource = [a, { ...b, sourceClientIds: ["a"] }];
    blocked(planQueueCombine(dupSource, ["a", "b"]), "duplicate-identity", dupSource);
    const dupTurn = [a, { ...b, turnId: "turn-a" }];
    blocked(planQueueCombine(dupTurn, ["a", "b"]), "duplicate-identity", dupTurn);
  });

  test("the admission snapshot is detached and deeply frozen; sent entries cannot re-snapshot", () => {
    const draft = entry("a", { attachments: [file("a")] });
    const combined = allowed(planQueueCombine([draft, entry("b")], ["a", "b"]))[0];
    if (!combined) throw new Error("Missing combined entry");
    const snapshot = snapshotForAdmission(combined);
    if (!snapshot) throw new Error("Missing admission snapshot");
    expect(snapshot).toEqual({
      clientId: "a",
      turnId: "turn-a",
      mode: "queue",
      target,
      text: "Message a\n\nMessage b",
      attachments: [file("a")],
      sourceClientIds: ["a", "b"],
      sourceTurnIds: ["turn-a", "turn-b"],
      batchId: queueBatchId(["a", "b"]),
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.target)).toBe(true);
    expect(Object.isFrozen(snapshot.attachments)).toBe(true);
    expect(Object.isFrozen(snapshot.attachments[0])).toBe(true);
    expect(Object.isFrozen(snapshot.sourceClientIds)).toBe(true);
    expect(Object.isFrozen(snapshot.sourceTurnIds)).toBe(true);
    const unsentEdit = allowed(planQueueEdit([combined], "a", "new text"))[0];
    expect(unsentEdit?.text).toBe("new text");
    expect(snapshot.text).toBe("Message a\n\nMessage b");
    const sent: OutboxQueueItem = { ...combined, phase: "sent" };
    expect(snapshotForAdmission(sent)).toBeNull();
    const sentQueue = [sent];
    blocked(planQueueEdit(sentQueue, "a", "new text"), "sent-unconfirmed", sentQueue, "reconcile");
    expect(snapshotForAdmission({ ...sent, phase: "started" })).toBeNull();
  });
});
