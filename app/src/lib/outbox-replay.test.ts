import { describe, expect, test } from "bun:test";
import type { ChatAttachment, ClientMessage } from "../../../shared/protocol";
import {
  planOutboxReplay,
  replayChatMessage,
  type OutboxReplayInput,
  type OutboxReplayMode,
  type OutboxReplayRecord,
  type OutboxReplayState,
  type OutboxReplayTarget,
  type ReplayConversation,
  type ReplayPeerCapabilities,
} from "./outbox-replay";

const originalTarget: OutboxReplayTarget = {
  harness: "hermes",
  hostId: "groot",
  profileId: "hermes:primary",
  sessionId: "session-1",
  cwd: "/workspace",
};
const safePeer: ReplayPeerCapabilities = {
  durablePrincipalDedupe: true,
  attach: true,
};

function record(
  clientId: string,
  turnId: string,
  state: OutboxReplayState = "sent",
  mode: OutboxReplayMode = "normal",
  conversationId = "c1",
): OutboxReplayRecord {
  return {
    clientId,
    turnId,
    conversationId,
    state,
    mode,
    target: originalTarget,
    payload: { text: `Request from ${clientId}` },
  };
}

function conversation(changes: Partial<ReplayConversation> = {}): ReplayConversation {
  return {
    conversationId: "c1",
    target: originalTarget,
    ended: false,
    queuePreviewOpen: false,
    queueWaitForIdle: false,
    ...changes,
  };
}

function snapshot(
  records: readonly OutboxReplayRecord[],
  options: Partial<OutboxReplayInput> = {},
): OutboxReplayInput {
  return {
    records,
    hydrated: true,
    peer: safePeer,
    conversations: [conversation()],
    activeTurns: [],
    ...options,
  };
}

describe("pure outbox reconnect replay planner", () => {
  test("lost acknowledgement replays exactly one identical record without minting ids", () => {
    const attachments: ChatAttachment[] = [
      { id: "upload-1", name: "photo.png", mime: "image/png", size: 12 },
      { id: "upload-2", name: "notes.txt", mime: "text/plain", size: 8 },
    ];
    const before: OutboxReplayRecord = {
      ...record("client-fixed", "turn-fixed"),
      mode: "queue",
      payload: { text: "Exact queued request\nsecond line", attachments },
    };
    const input = snapshot([before]);
    const first = planOutboxReplay(input);
    const second = planOutboxReplay(input);

    expect(first).toHaveLength(1);
    expect(first[0]?.kind).toBe("replay");
    expect(first[0]?.record).toBe(before);
    expect(second).toEqual(first);
    expect(second[0]?.record).toBe(before);
    expect(before.clientId).toBe("client-fixed");
    expect(before.turnId).toBe("turn-fixed");
    expect(before.mode).toBe("queue");
    expect(before.payload.attachments).toBe(attachments);
    expect(before.payload.attachments?.map((item) => item.id)).toEqual(["upload-1", "upload-2"]);
  });

  test("a never-sent queued record has the same identity requirements as lost-ack replay", () => {
    const pending = record("same-client", "same-turn", "queued");
    const result = planOutboxReplay(snapshot([pending]));
    expect(result).toEqual([{ kind: "replay", record: pending }]);
  });

  test("acked and started records attach instead of starting another chat", () => {
    const acked = { ...record("ca", "ta", "acked-by-bridge"), lastSeenSeq: 7 };
    const started = { ...record("cb", "tb", "started", "normal", "c2"), lastSeenSeq: 12 };
    const plan = planOutboxReplay(snapshot([acked, started], {
      conversations: [conversation(), conversation({ conversationId: "c2" })],
    }));
    expect(plan).toEqual([
      { kind: "reconcile", record: acked, attach: { id: "ta", seq: 7 } },
      { kind: "reconcile", record: started, attach: { id: "tb", seq: 12 } },
    ]);
    expect(plan.some((step) => step.kind === "replay")).toBe(false);
  });

  test("an authoritative running turn overrides a stale sent state", () => {
    const pending = record("client", "turn", "sent");
    const plan = planOutboxReplay(snapshot([pending], {
      activeTurns: [{ conversationId: "c1", turnId: "turn" }],
    }));
    expect(plan).toEqual([{ kind: "reconcile", record: pending, attach: { id: "turn", seq: 0 } }]);
  });

  test("an unsupported peer never causes a blind resend or false acknowledgement", () => {
    const queued = record("queued", "t1", "queued");
    const unacked = record("unacked", "t2", "sent", "normal", "c2");
    const output = planOutboxReplay(snapshot([queued, unacked], {
      conversations: [conversation(), conversation({ conversationId: "c2" })],
      peer: { durablePrincipalDedupe: false, attach: true },
    }));
    expect(output.map((entry) => [entry.kind, "reason" in entry ? entry.reason : null])).toEqual([
      ["unconfirmed", "no-durable-dedupe"],
      ["unconfirmed", "no-durable-dedupe"],
    ]);
    expect(output.some((entry) => entry.kind === "replay")).toBe(false);
    const unknown = planOutboxReplay(snapshot([unacked], {
      conversations: [conversation({ conversationId: "c2" })],
      peer: null,
    }));
    expect(unknown[0]?.kind).toBe("unconfirmed");
  });

  test("a bridge without attach leaves already-accepted execution unconfirmed", () => {
    const accepted = record("c", "t", "acked-by-bridge");
    const steps = planOutboxReplay(snapshot([accepted], {
      peer: { durablePrincipalDedupe: true, attach: false },
    }));
    expect(steps[0]).toMatchObject({ kind: "unconfirmed", reason: "no-attach" });
  });

  test("hydration must finish before any network actions or legacy classification", () => {
    const first = record("c1", "t1");
    const second = record("c2", "t2", "started", "normal", "c2");
    const steps = planOutboxReplay(snapshot([first, second], {
      hydrated: false,
      peer: null,
    }));
    expect(steps.map((step) => [step.kind, "reason" in step ? step.reason : null])).toEqual([
      ["wait", "hydration-pending"],
      ["wait", "hydration-pending"],
    ]);
  });

  test("changed host, profile, session, harness and working directory all require review", () => {
    const pending = record("c1", "t1");
    const alternatives: OutboxReplayTarget[] = [
      { ...originalTarget, hostId: "different" },
      { ...originalTarget, profileId: "different" },
      { ...originalTarget, sessionId: "different" },
      { ...originalTarget, harness: "omp" },
      { ...originalTarget, cwd: "/elsewhere" },
    ];
    for (const target of alternatives) {
      const steps = planOutboxReplay(snapshot([pending], {
        conversations: [conversation({ target })],
      }));
      expect(steps[0]).toMatchObject({ kind: "review", reason: "target-changed" });
    }
    expect(planOutboxReplay(snapshot([pending], {
      conversations: [conversation({ target: null })],
    }))[0]).toMatchObject({ kind: "review", reason: "target-changed" });
  });

  test("ended or missing sessions cannot be replaced by a new chat on another target", () => {
    const pending = record("c", "t", "sent", "steer");
    expect(planOutboxReplay(snapshot([pending], {
      conversations: [conversation({ ended: true })],
      activeTurns: [{ conversationId: "c1", turnId: "other" }],
    }))[0]).toMatchObject({ kind: "review", reason: "session-ended" });
    expect(planOutboxReplay(snapshot([pending], {
      conversations: [],
    }))[0]).toMatchObject({ kind: "review", reason: "missing-conversation" });
    expect(planOutboxReplay(snapshot([pending], {
      conversations: [conversation(), conversation()],
    }))[0]).toMatchObject({ kind: "review", reason: "ambiguous-conversation" });
  });

  test("preview and wait-for-idle flags block replay even with a safe peer", () => {
    const pending = record("c", "t", "queued", "queue");
    expect(planOutboxReplay(snapshot([pending], {
      conversations: [conversation({ queuePreviewOpen: true })],
    }))[0]).toMatchObject({ kind: "wait", reason: "queue-preview" });
    expect(planOutboxReplay(snapshot([pending], {
      conversations: [conversation({ queueWaitForIdle: true })],
    }))[0]).toMatchObject({ kind: "wait", reason: "queue-wait" });
  });

  test("offline steer is never silently changed to a normal or queued chat", () => {
    const steer = record("s", "st", "sent", "steer");
    const noActive = planOutboxReplay(snapshot([steer], {
      activeTurns: [{ conversationId: "c2", turnId: "unrelated" }],
    }));
    expect(noActive[0]).toMatchObject({ kind: "review", reason: "steer-no-active-turn" });
    const running = planOutboxReplay(snapshot([steer], {
      activeTurns: [{ conversationId: "c1", turnId: "currently-running" }],
    }));
    expect(running).toEqual([{ kind: "replay", record: steer }]);
    expect(running[0]?.record.mode).toBe("steer");
    expect(running[0]?.record.turnId).toBe("st");
  });

  test("normal and queued messages wait behind an active turn", () => {
    const queued = record("n", "nt", "sent", "queue");
    const result = planOutboxReplay(snapshot([queued], {
      activeTurns: [{ conversationId: "c1", turnId: "another-turn" }],
    }));
    expect(result[0]).toMatchObject({ kind: "wait", reason: "active-turn" });
  });

  test("an earlier unresolved entry blocks later sends in the same conversation only", () => {
    const first = record("first", "t1");
    const second = record("second", "t2");
    const independent = record("other", "t3", "sent", "normal", "c2");
    const steps = planOutboxReplay(snapshot([first, second, independent], {
      conversations: [conversation(), conversation({ conversationId: "c2" })],
    }));
    expect(steps.map((step) => step.kind)).toEqual(["replay", "wait", "replay"]);
    expect(steps[1]).toMatchObject({ reason: "earlier-unresolved" });
    expect(steps[0]?.record).toBe(first);
    expect(steps[2]?.record).toBe(independent);
  });

  test("acked turns may reconcile through a preview, but still hold later queue sends", () => {
    const acknowledged = record("accepted", "ta", "acked-by-bridge");
    const next = record("following", "tb", "queued", "queue");
    const steps = planOutboxReplay(snapshot([acknowledged, next], {
      conversations: [conversation({ queuePreviewOpen: true })],
    }));
    expect(steps[0]?.kind).toBe("reconcile");
    expect(steps[1]).toMatchObject({ kind: "wait", reason: "earlier-unresolved" });
  });

  test("duplicate clientIds or turnIds cause review for every collision, not two sends", () => {
    const first = record("collision", "t1");
    const sameClient = record("collision", "t2", "sent", "normal", "c2");
    const sameTurn = record("different", "t1", "sent", "normal", "c3");
    const steps = planOutboxReplay(snapshot([first, sameClient, sameTurn], {
      conversations: [
        conversation(),
        conversation({ conversationId: "c2" }),
        conversation({ conversationId: "c3" }),
      ],
    }));
    expect(steps.map((step) => [step.kind, "reason" in step ? step.reason : null])).toEqual([
      ["review", "duplicate-identity"],
      ["review", "duplicate-identity"],
      ["review", "duplicate-identity"],
    ]);
  });

  test("invalid ids and expired attachments are review actions, not sends", () => {
    const broken = record("", "valid");
    expect(planOutboxReplay(snapshot([broken]))[0]).toMatchObject({
      kind: "review", reason: "invalid-identity",
    });
    const expired: OutboxReplayRecord = {
      ...record("c", "t"),
      attachmentProblem: "Local attachment reference expired; reselect it.",
    };
    expect(planOutboxReplay(snapshot([expired]))[0]).toMatchObject({
      kind: "review", reason: "attachment-problem",
    });
  });

  test("reconciliation uses only a valid persisted sequence", () => {
    const invalid: OutboxReplayRecord = {
      ...record("c", "t", "started"),
      lastSeenSeq: Number.POSITIVE_INFINITY,
    };
    expect(planOutboxReplay(snapshot([invalid]))[0]).toMatchObject({
      kind: "reconcile", attach: { id: "t", seq: 0 },
    });
  });

  test("planner does not mutate frozen snapshots or their attachment refs", () => {
    const attachments = Object.freeze([
      Object.freeze({ id: "file-1", name: "log.txt", mime: "text/plain", size: 20 }),
    ]);
    const pending: OutboxReplayRecord = Object.freeze({
      ...record("locked", "turn"),
      payload: Object.freeze({ text: "unchanged", attachments }),
      target: Object.freeze({ ...originalTarget }),
    });
    const source = Object.freeze([pending]);
    const context = Object.freeze([Object.freeze(conversation())]);
    const steps = planOutboxReplay(snapshot(source, { conversations: context }));
    expect(steps).toEqual([{ kind: "replay", record: pending }]);
    expect(source[0]?.payload.attachments).toBe(attachments);
  });
  test("wire replay preserves clientId, turnId, route, steering, text, flags and attachment order", () => {
    const attachments: ChatAttachment[] = [
      { id: "a1", name: "first.png", mime: "image/png", size: 1 },
      { id: "a2", name: "second.png", mime: "image/png", size: 2 },
    ];
    const steer: OutboxReplayRecord = {
      ...record("client-stable", "turn-stable", "sent", "steer"),
      payload: { text: "Steer here", summariesEnabled: false, attachments },
    };
    const planned = planOutboxReplay(snapshot([steer], {
      activeTurns: [{ conversationId: "c1", turnId: "live-turn" }],
    }));
    expect(planned[0]?.kind).toBe("replay");
    const wire = replayChatMessage(steer);
    const compatibleLegacyChat: ClientMessage = wire;
    expect(compatibleLegacyChat.type).toBe("chat");
    expect(wire).toMatchObject({
      type: "chat",
      clientId: "client-stable",
      id: "turn-stable",
      harness: "hermes",
      hostId: "groot",
      profileId: "hermes:primary",
      sessionId: "session-1",
      cwd: "/workspace",
      text: "Steer here",
      mode: "steer",
      summariesEnabled: false,
      attachments,
    });
    expect(wire.attachments).not.toBe(attachments);
    expect(wire.attachments?.[0]).not.toBe(attachments[0]);
    expect(steer.payload.attachments).toBe(attachments);
    expect("mode" in replayChatMessage(record("normal", "another"))).toBe(false);
    expect(replayChatMessage(record("queue", "queued-turn", "queued", "queue")).mode).toBe("queue");
  });

});
