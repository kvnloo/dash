import { MAX_ATTACHMENTS_PER_TURN, type ChatAttachment } from "../../../shared/protocol";

/**
 * Structural companion to delivery-state and outbox. A transport write is NOT
 * acknowledgement. The outbox owns persistence, phase changes, and replay.
 * This planner never deletes or rewrites an admitted (or possibly admitted) turn.
 */
export type QueueIntent = "queue" | "steer";
export type QueueDeliveryPhase = "queued" | "sent" | "acked-by-bridge" | "started";

export interface QueueTarget {
  readonly conversationId: string;
  readonly harness: string;
  readonly hostId?: string;
  readonly profileId?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
}

export interface OutboxQueueItem {
  /** Stable transport identities. Combining before admission retains the first pair. */
  readonly clientId: string;
  readonly turnId: string;
  readonly intent: QueueIntent;
  readonly phase: QueueDeliveryPhase;
  readonly target: Readonly<QueueTarget>;
  readonly text: string;
  readonly attachments: readonly Readonly<ChatAttachment>[];
  /** Original identities, including entries folded into a queued batch. */
  readonly sourceClientIds: readonly string[];
  readonly sourceTurnIds: readonly string[];
  /** Deterministic from ordered original client ids; not a replacement turn id. */
  readonly batchId?: string;
}

export type QueueBlockReason =
  | "not-found"
  | "source-in-batch"
  | "invalid-selection"
  | "invalid-position"
  | "noncontiguous-selection"
  | "duplicate-identity"
  | "mixed-intent"
  | "steer-not-combinable"
  | "target-mismatch"
  | "attachment-limit"
  | "empty-payload"
  | "sent-unconfirmed"
  | "already-admitted";

export type QueueBlockResolution = "correct-input" | "reconcile" | "retain-admitted";

export type QueuePlan =
  | { readonly allowed: true; readonly items: readonly OutboxQueueItem[] }
  | {
      readonly allowed: false;
      /** Exact unchanged input, including bridge-admitted entries. */
      readonly items: readonly OutboxQueueItem[];
      readonly reason: QueueBlockReason;
      readonly resolution: QueueBlockResolution;
      readonly affectedClientIds: readonly string[];
    };

export interface QueueAdmissionSnapshot {
  readonly clientId: string;
  readonly turnId: string;
  readonly mode: QueueIntent;
  readonly target: Readonly<QueueTarget>;
  readonly text: string;
  readonly attachments: readonly Readonly<ChatAttachment>[];
  readonly sourceClientIds: readonly string[];
  readonly sourceTurnIds: readonly string[];
  readonly batchId?: string;
}

/** Use this at enqueue; no id factory, clock, or mutable reference is hidden here. */
export function createOutboxQueueItem(input: {
  readonly clientId: string;
  readonly turnId: string;
  readonly intent: QueueIntent;
  readonly target: QueueTarget;
  readonly text: string;
  readonly attachments?: readonly Readonly<ChatAttachment>[];
}): OutboxQueueItem {
  return {
    clientId: input.clientId,
    turnId: input.turnId,
    intent: input.intent,
    phase: "queued",
    target: { ...input.target },
    text: input.text,
    attachments: (input.attachments ?? []).map(file => ({ ...file })),
    sourceClientIds: [input.clientId],
    sourceTurnIds: [input.turnId],
  };
}

/**
 * Example integration: persist this snapshot with the sibling outbox's "sent"
 * phase BEFORE calling transport. Never re-create it with new ids after a lost
 * acknowledgement. Outbox reconciliation, not this planner, owns any replay.
 * Freezing fresh copies makes accidental post-admission writes fail closed.
 */
export function snapshotForAdmission(item: OutboxQueueItem): QueueAdmissionSnapshot | null {
  if (item.phase !== "queued") return null;
  const attachments = Object.freeze(item.attachments.map(file => Object.freeze({ ...file })));
  return Object.freeze({
    clientId: item.clientId,
    turnId: item.turnId,
    mode: item.intent,
    target: Object.freeze({ ...item.target }),
    text: item.text,
    attachments,
    sourceClientIds: Object.freeze([...item.sourceClientIds]),
    sourceTurnIds: Object.freeze([...item.sourceTurnIds]),
    ...(item.batchId === undefined ? {} : { batchId: item.batchId }),
  });
}

function allow(items: readonly OutboxQueueItem[]): QueuePlan {
  return { allowed: true, items };
}

function block(
  items: readonly OutboxQueueItem[],
  reason: QueueBlockReason,
  affectedClientIds: readonly string[] = [],
  resolution: QueueBlockResolution = "correct-input",
): QueuePlan {
  return { allowed: false, items, reason, resolution, affectedClientIds };
}

function blockAdmitted(items: readonly OutboxQueueItem[], item: OutboxQueueItem): QueuePlan {
  return item.phase === "sent"
    ? block(items, "sent-unconfirmed", [item.clientId], "reconcile")
    : block(items, "already-admitted", [item.clientId], "retain-admitted");
}

function targetMatches(a: QueueTarget, b: QueueTarget): boolean {
  return a.conversationId === b.conversationId
    && a.harness === b.harness
    && a.hostId === b.hostId
    && a.profileId === b.profileId
    && a.sessionId === b.sessionId
    && a.cwd === b.cwd;
}

function missingIdentity(items: readonly OutboxQueueItem[], id: string): QueuePlan {
  return block(items, items.some(item => item.sourceClientIds.includes(id)) ? "source-in-batch" : "not-found", [id]);
}

/** Edit only an unadmitted payload; never rotate clientId, turnId, or batchId. */
export function planQueueEdit(items: readonly OutboxQueueItem[], clientId: string, text: string): QueuePlan {
  const index = items.findIndex(item => item.clientId === clientId);
  if (index < 0) return missingIdentity(items, clientId);
  const item = items[index];
  if (!item) return missingIdentity(items, clientId);
  if (item.phase !== "queued") return blockAdmitted(items, item);
  if (!text.trim() && !item.attachments.length) return block(items, "empty-payload", [clientId]);
  if (text === item.text) return allow(items);
  return allow(items.map((entry, i) => i === index ? { ...item, text } : entry));
}

/** Local removal cannot erase a sent, unconfirmed, acked, or started bridge turn. */
export function planQueueRemove(items: readonly OutboxQueueItem[], clientId: string): QueuePlan {
  const index = items.findIndex(item => item.clientId === clientId);
  if (index < 0) return missingIdentity(items, clientId);
  const item = items[index];
  if (!item) return missingIdentity(items, clientId);
  if (item.phase !== "queued") return blockAdmitted(items, item);
  return allow(items.filter((_, i) => i !== index));
}

/**
 * Indices refer to the entire displayed queue. Crossing an admitted, steering,
 * or differently targeted entry would change execution semantics, so reject it.
 */
export function planQueueReorder(items: readonly OutboxQueueItem[], from: number, to: number): QueuePlan {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return block(items, "invalid-position");
  }
  const moving = items[from];
  if (!moving) return block(items, "invalid-position");
  if (moving.phase !== "queued") return blockAdmitted(items, moving);
  if (from === to) return allow(items);

  const crossed = items.slice(Math.min(from, to), Math.max(from, to) + 1);
  for (const entry of crossed) {
    if (entry.phase !== "queued") return blockAdmitted(items, entry);
    if (entry.intent !== moving.intent) return block(items, "mixed-intent", [moving.clientId, entry.clientId]);
    if (!targetMatches(entry.target, moving.target)) return block(items, "target-mismatch", [moving.clientId, entry.clientId]);
  }
  const reordered = [...items];
  const [item] = reordered.splice(from, 1);
  if (!item) return block(items, "invalid-position");
  reordered.splice(to, 0, item);
  return allow(reordered);
}

/** Length-prefixing makes source id sequences unambiguous, without a new RNG. */
export function queueBatchId(sourceClientIds: readonly string[]): string {
  return "batch:" + sourceClientIds.map(id => String(id.length) + ":" + id).join("");
}

/**
 * Combine at least two contiguous, unadmitted NORMAL queue entries.
 * The first entry remains the transport carrier (clientId/turnId). All original
 * ids and files remain in-order provenance, and one explicit batchId is formed.
 * This operation is forbidden for steer, mixed targets, and sent entries.
 */
export function planQueueCombine(
  items: readonly OutboxQueueItem[],
  clientIds: readonly string[],
  previewText?: string,
): QueuePlan {
  if (clientIds.length < 2 || new Set(clientIds).size !== clientIds.length) {
    return block(items, "invalid-selection", clientIds);
  }
  const indices: number[] = [];
  for (const id of clientIds) {
    const index = items.findIndex(item => item.clientId === id);
    if (index < 0) return missingIdentity(items, id);
    indices.push(index);
  }
  indices.sort((a, b) => a - b);
  const selected = indices.flatMap(index => {
    const item = items[index];
    return item ? [item] : [];
  });
  if (selected.length !== indices.length) return block(items, "invalid-selection", clientIds);
  const first = selected[0];
  const firstIndex = indices[0];
  if (!first || firstIndex === undefined) return block(items, "invalid-selection", clientIds);
  for (const entry of selected) {
    if (entry.phase !== "queued") return blockAdmitted(items, entry);
  }
  if (selected.some(item => item.intent !== first.intent)) return block(items, "mixed-intent", clientIds);
  if (first.intent === "steer") return block(items, "steer-not-combinable", clientIds);
  if (selected.some(item => !targetMatches(first.target, item.target))) return block(items, "target-mismatch", clientIds);
  if (indices.some((index, offset) => index !== firstIndex + offset)) return block(items, "noncontiguous-selection", clientIds);

  // Reject corrupted/repeated source ids before creating a batch that could be replayed twice.
  const allClientIds = items.flatMap(item => item.sourceClientIds);
  const allTurnIds = items.flatMap(item => item.sourceTurnIds);
  const activeClientIds = items.map(item => item.clientId);
  const activeTurnIds = items.map(item => item.turnId);
  if (new Set(allClientIds).size !== allClientIds.length
    || new Set(allTurnIds).size !== allTurnIds.length
    || new Set(activeClientIds).size !== activeClientIds.length
    || new Set(activeTurnIds).size !== activeTurnIds.length) {
    return block(items, "duplicate-identity", clientIds);
  }

  const attachments = selected.flatMap(item => item.attachments.map(file => ({ ...file })));
  if (attachments.length > MAX_ATTACHMENTS_PER_TURN) return block(items, "attachment-limit", clientIds);
  const text = previewText ?? selected.map(item => item.text).join("\n\n");
  if (!text.trim() && !attachments.length) return block(items, "empty-payload", clientIds);
  const sourceClientIds = selected.flatMap(item => item.sourceClientIds);
  const sourceTurnIds = selected.flatMap(item => item.sourceTurnIds);
  const combined: OutboxQueueItem = {
    ...first,
    text,
    attachments,
    sourceClientIds,
    sourceTurnIds,
    batchId: queueBatchId(sourceClientIds),
  };
  const selectedIndices = new Set(indices);
  return allow(items.flatMap((item, index) => {
    if (!selectedIndices.has(index)) return [item];
    return index === firstIndex ? [combined] : [];
  }));
}
