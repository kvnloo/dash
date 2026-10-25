import type { ChatAttachment } from "../../../shared/protocol";

/**
 * The persisted outbox owns these values. Planning never mints a replacement id,
 * rewrites a steer as a queue, or changes an immutable send fingerprint.
 */
export interface OutboxReplayTarget {
  readonly harness: string;
  readonly hostId?: string;
  readonly profileId?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
}

export interface OutboxReplayPayload {
  readonly text: string;
  readonly attachments?: readonly ChatAttachment[];
}

export type OutboxReplayState = "queued" | "sent" | "acked-by-bridge" | "started";
export type OutboxReplayMode = "normal" | "queue" | "steer";

export interface OutboxReplayRecord {
  readonly clientId: string;
  readonly turnId: string;
  readonly conversationId: string;
  readonly state: OutboxReplayState;
  readonly mode: OutboxReplayMode;
  readonly target: Readonly<OutboxReplayTarget>;
  readonly payload: Readonly<OutboxReplayPayload>;
  /** Last event sequence actually persisted on the phone; never a remote guess. */
  readonly lastSeenSeq?: number;
  /** Set by storage/upload validation when an attachment needs user intervention. */
  readonly attachmentProblem?: string;
}

export interface ReplayConversation {
  readonly conversationId: string;
  /** Current resolved route, not a fallback picked by the reconnect handler. */
  readonly target: Readonly<OutboxReplayTarget> | null;
  readonly ended: boolean;
  readonly queuePreviewOpen: boolean;
  readonly queueWaitForIdle: boolean;
}

/** An authoritative observation from the bridge, not a locally streaming UI row. */
export interface ReplayActiveTurn {
  readonly conversationId: string;
  readonly turnId: string;
}

export interface ReplayPeerCapabilities {
  /**
   * True ONLY when the authenticated peer advertises durable, fingerprint-checked,
   * principal-scoped admission keyed by the same clientId/turnId. Legacy hello
   * does not imply this, even though it already supports a basic chat send.
   */
  readonly durablePrincipalDedupe: boolean;
  /** The bridge can reconcile an existing turn using the legacy attach request. */
  readonly attach: boolean;
}

export interface OutboxReplayInput {
  /** Only unresolved persisted records, in their original enqueue order. */
  readonly records: readonly OutboxReplayRecord[];
  readonly conversations: readonly ReplayConversation[];
  readonly activeTurns: readonly ReplayActiveTurn[];
  readonly hydrated: boolean;
  /** Null/absent capabilities describe a legacy or unverified peer. */
  readonly peer: ReplayPeerCapabilities | null;
}

export type ReplayBlockReason =
  | "hydration-pending"
  | "duplicate-identity"
  | "invalid-identity"
  | "missing-conversation"
  | "ambiguous-conversation"
  | "session-ended"
  | "target-changed"
  | "attachment-problem"
  | "earlier-unresolved"
  | "queue-preview"
  | "queue-wait"
  | "active-turn"
  | "steer-no-active-turn"
  | "no-durable-dedupe"
  | "no-attach";

export type ReplayDecision =
  | {
      readonly kind: "replay";
      /** Same object, ids, mode, target, text and attachment references as persisted. */
      readonly record: OutboxReplayRecord;
    }
  | {
      readonly kind: "reconcile";
      readonly record: OutboxReplayRecord;
      /** Attach to this turn only; NEVER issue a new chat for it. */
      readonly attach: { readonly id: string; readonly seq: number };
    }
  | {
      readonly kind: "wait" | "review" | "unconfirmed";
      readonly record: OutboxReplayRecord;
      readonly reason: ReplayBlockReason;
      readonly detail: string;
    };

function block(
  kind: "wait" | "review" | "unconfirmed",
  record: OutboxReplayRecord,
  reason: ReplayBlockReason,
  detail: string,
): ReplayDecision {
  return { kind, record, reason, detail };
}

function sameTarget(a: OutboxReplayTarget, b: OutboxReplayTarget): boolean {
  return a.harness === b.harness &&
    a.hostId === b.hostId &&
    a.profileId === b.profileId &&
    a.sessionId === b.sessionId &&
    a.cwd === b.cwd;
}

function count(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function persistedSeq(record: OutboxReplayRecord): number {
  const seq = record.lastSeenSeq;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
}

/**
 * Pure, fail-closed reconnect plan. A replay is an instruction to send the
 * IDENTICAL persisted record through the authenticated, idempotent adapter,
 * not a new turn. The caller must serialize the actual send, preserve the
 * record until a receipt arrives, and feed receipts back into the outbox.
 *
 * Each decision corresponds to one input record in input order. At most one
 * unresolved send per conversation is replayable per planning pass; a later
 * send waits for settlement. Independent conversations do not block each other.
 */
export function planOutboxReplay(input: OutboxReplayInput): ReplayDecision[] {
  const decisions: ReplayDecision[] = [];
  const clientCounts = count(input.records.map((record) => record.clientId));
  const turnCounts = count(input.records.map((record) => record.turnId));
  const conversationCounts = count(input.conversations.map((item) => item.conversationId));
  const conversations = new Map(input.conversations.map((item) => [item.conversationId, item]));
  const held = new Set<string>();

  for (const record of input.records) {
    if (!input.hydrated) {
      decisions.push(block("wait", record, "hydration-pending", "Load the durable outbox before reconnect delivery."));
      continue;
    }

    if (!record.clientId.trim() || !record.turnId.trim() || !record.conversationId.trim()) {
      decisions.push(block("review", record, "invalid-identity", "Persisted delivery identity is incomplete; do not send."));
      held.add(record.conversationId);
      continue;
    }
    if (clientCounts.get(record.clientId) !== 1 || turnCounts.get(record.turnId) !== 1) {
      decisions.push(block("review", record, "duplicate-identity", "Multiple persisted records share a delivery identity."));
      held.add(record.conversationId);
      continue;
    }

    const conversation = conversations.get(record.conversationId);
    if (!conversation) {
      decisions.push(block("review", record, "missing-conversation", "Conversation route is unavailable; confirm target."));
      held.add(record.conversationId);
      continue;
    }
    if (conversationCounts.get(record.conversationId) !== 1) {
      decisions.push(block("review", record, "ambiguous-conversation", "Multiple current routes match this conversation."));
      held.add(record.conversationId);
      continue;
    }
    if (conversation.ended) {
      decisions.push(block("review", record, "session-ended", "Session ended; choose whether and where to continue."));
      held.add(record.conversationId);
      continue;
    }
    if (!conversation.target || !sameTarget(record.target, conversation.target)) {
      decisions.push(block("review", record, "target-changed", "The original host, profile, harness or session changed; review before sending."));
      held.add(record.conversationId);
      continue;
    }

    const activeForConversation = input.activeTurns.filter((turn) => turn.conversationId === record.conversationId);
    const sameTurnActive = activeForConversation.some((turn) => turn.turnId === record.turnId);
    // A receipt or authoritative active turn means execution may have begun.
    // Reconcile even when a queue preview is open; previews block NEW sends only.
    if (record.state === "acked-by-bridge" || record.state === "started" || sameTurnActive) {
      decisions.push(input.peer?.attach
        ? { kind: "reconcile", record, attach: { id: record.turnId, seq: persistedSeq(record) } }
        : block("unconfirmed", record, "no-attach", "Bridge cannot attach to this accepted or active turn; reconcile manually."));
      held.add(record.conversationId);
      continue;
    }

    if (held.has(record.conversationId)) {
      decisions.push(block("wait", record, "earlier-unresolved", "An earlier send in this conversation must settle first."));
    } else if (record.attachmentProblem) {
      decisions.push(block("review", record, "attachment-problem", record.attachmentProblem));
    } else if (conversation.queuePreviewOpen) {
      decisions.push(block("wait", record, "queue-preview", "Finish or dismiss the queue merge preview first."));
    } else if (conversation.queueWaitForIdle) {
      decisions.push(block("wait", record, "queue-wait", "Queue delivery is paused until the user releases it."));
    } else if (record.mode === "steer" && activeForConversation.length === 0) {
      decisions.push(block("review", record, "steer-no-active-turn", "Original steer target is no longer running; do not turn it into a queued chat."));
    } else if (record.mode !== "steer" && activeForConversation.length > 0) {
      decisions.push(block("wait", record, "active-turn", "Wait for the running turn before starting another queued send."));
    } else if (!input.peer?.durablePrincipalDedupe) {
      decisions.push(block("unconfirmed", record, "no-durable-dedupe", "Delivery is unconfirmed. This bridge cannot safely replay the same send automatically."));
    } else {
      // No serialization, cloning, generated ids or mode conversion here.
      decisions.push({ kind: "replay", record });
    }
    held.add(record.conversationId);
  }
  return decisions;
}
