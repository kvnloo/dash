import { describe, expect, test } from "bun:test";
import {
  createDelivery,
  deliveryAction,
  deliveryIdentity,
  reduceDelivery,
  type DeliveryIdentity,
  type DeliveryRecord,
} from "./delivery-state";

function queued(): DeliveryRecord {
  return createDelivery({
    clientId: "client-1",
    turnId: "turn-1",
    conversationId: "conversation-1",
    target: {
      harness: "hermes",
      hostId: "host-1",
      profileId: "profile-1",
      sessionId: "session-1",
      cwd: "/work",
      mode: "steer",
    },
    payload: {
      text: "Keep the original instruction",
      summariesEnabled: true,
      attachments: [{ id: "a".repeat(32), name: "reference.txt", mime: "text/plain", size: 3 }],
    },
    at: 100,
  });
}

function send(record: DeliveryRecord, accepted: boolean, at: number): DeliveryRecord {
  return reduceDelivery(record, { ...deliveryIdentity(record), type: "transport", accepted, at });
}

function receipt(record: DeliveryRecord, stage: "acked-by-bridge" | "started", at: number): DeliveryRecord {
  return reduceDelivery(record, { ...deliveryIdentity(record), type: "receipt", stage, at });
}

function timeout(record: DeliveryRecord, at: number): DeliveryRecord {
  return reduceDelivery(record, { ...deliveryIdentity(record), type: "timeout", at });
}

function reconcile(
  record: DeliveryRecord,
  outcome: "unknown" | "not-admitted" | "acked-by-bridge" | "started" | "rejected",
  at: number,
): DeliveryRecord {
  return reduceDelivery(record, { ...deliveryIdentity(record), type: "reconcile", outcome, at });
}

function retry(record: DeliveryRecord, at: number): DeliveryRecord {
  return reduceDelivery(record, { ...deliveryIdentity(record), type: "retry", at });
}

describe("pure delivery state machine", () => {
  test("queued -> sent -> bridge acknowledgement -> started requires independent evidence", () => {
    const initial = queued();
    expect(initial.phase).toBe("queued");
    expect(initial.status).toBe("ready");
    expect(initial.attempts).toBe(0);
    expect(initial.createdAt).toBe(100);
    expect(deliveryAction(initial)).toBe("send");

    const written = send(initial, true, 101);
    expect(written.phase).toBe("sent");
    expect(written.status).toBe("awaiting-ack");
    expect(written.attempts).toBe(1);
    expect(written.sentAt).toBe(101);
    expect(written.acknowledgedAt).toBeUndefined();
    expect(written.startedAt).toBeUndefined();
    expect(deliveryAction(written)).toBe("none");
    expect(send(written, true, 102)).toBe(written); // duplicate socket callback

    const admitted = receipt(written, "acked-by-bridge", 103);
    expect(admitted.phase).toBe("acked-by-bridge");
    expect(admitted.status).toBe("accepted");
    expect(admitted.acknowledgedAt).toBe(103);
    expect(admitted.startedAt).toBeUndefined();
    expect(deliveryAction(admitted)).toBe("none");

    const running = receipt(admitted, "started", 104);
    expect(running.phase).toBe("started");
    expect(running.status).toBe("started");
    expect(running.startedAt).toBe(104);
    expect(running.acknowledgedAt).toBe(103);
    expect(running.updatedAt).toBe(104);
    expect(initial.status).toBe("ready"); // reducer never mutates input
  });

  test("out-of-order and duplicate receipts never roll the phase back", () => {
    const written = send(queued(), true, 110);
    const startedFirst = receipt(written, "started", 120);
    expect(startedFirst.phase).toBe("started");
    expect(startedFirst.startedAt).toBe(120);
    // A started receipt proves execution; it does not fabricate an ack timestamp.
    expect(startedFirst.acknowledgedAt).toBeUndefined();
    expect(receipt(startedFirst, "acked-by-bridge", 115)).toBe(startedFirst);
    expect(receipt(startedFirst, "started", 130)).toBe(startedFirst);
    expect(timeout(startedFirst, 140)).toBe(startedFirst);
    expect(send(startedFirst, true, 141)).toBe(startedFirst);
    expect(startedFirst.updatedAt).toBe(120);
    expect(receipt(written, "acked-by-bridge", 99)).toBe(written); // older than this turn
    expect(timeout(written, 105)).toBe(written); // predates this socket attempt
  });

  test("wrong client, turn, conversation, or target never cross-links a receipt", () => {
    const written = send(queued(), true, 105);
    const scope = deliveryIdentity(written);
    const wrongScopes: DeliveryIdentity[] = [
      { ...scope, clientId: "client-2" },
      { ...scope, turnId: "turn-2" },
      { ...scope, conversationId: "conversation-2" },
      { ...scope, target: { ...scope.target, hostId: "host-2" } },
      { ...scope, target: { ...scope.target, sessionId: "session-2" } },
      { ...scope, target: { ...scope.target, profileId: "profile-2" } },
      { ...scope, target: { ...scope.target, harness: "omp" } },
      { ...scope, target: { ...scope.target, cwd: "/other" } },
      { ...scope, target: { ...scope.target, mode: "queue" } },
    ];
    for (const wrong of wrongScopes) {
      expect(reduceDelivery(written, { ...wrong, type: "receipt", stage: "started", at: 110 })).toBe(written);
      expect(reduceDelivery(written, { ...wrong, type: "rejected", message: "wrong", at: 110 })).toBe(written);
      expect(reduceDelivery(written, { ...wrong, type: "timeout", at: 110 })).toBe(written);
    }
    expect(receipt(written, "acked-by-bridge", 110).phase).toBe("acked-by-bridge");
  });

  test("an unsolicited receipt cannot create delivery after a rejected socket write", () => {
    const initial = queued();
    expect(receipt(initial, "started", 105)).toBe(initial);
    const failed = send(initial, false, 110);
    expect(failed.phase).toBe("queued");
    expect(failed.status).toBe("retry-needed");
    expect(failed.attempts).toBe(1);
    expect(failed.failure?.kind).toBe("transport");
    expect(deliveryAction(failed)).toBe("retry");
    expect(receipt(failed, "acked-by-bridge", 111)).toBe(failed);
    expect(send(failed, true, 112)).toBe(failed); // explicit retry action required

    const ready = retry(failed, 113);
    expect(ready.status).toBe("ready");
    const written = send(ready, true, 114);
    expect(written.phase).toBe("sent");
    expect(written.attempts).toBe(2);
    expect(written.clientId).toBe(initial.clientId);
    expect(written.turnId).toBe(initial.turnId);
    expect(written.payload).toBe(initial.payload);
    expect(written.target).toBe(initial.target);
  });

  test("missing ack makes the result unknown, not rejected or safe to resend", () => {
    const written = send(queued(), true, 110);
    const unknown = timeout(written, 120);
    expect(unknown.phase).toBe("sent");
    expect(unknown.status).toBe("reconcile-required");
    expect(unknown.failure?.kind).toBe("timeout");
    expect(unknown.failure?.message).toContain("outcome unknown");
    expect(deliveryAction(unknown)).toBe("reconcile");
    expect(retry(unknown, 121)).toBe(unknown);
    expect(send(unknown, true, 122)).toBe(unknown);
    expect(reconcile(unknown, "unknown", 123)).toBe(unknown);

    const confirmedAbsent = reconcile(unknown, "not-admitted", 124);
    expect(confirmedAbsent.phase).toBe("sent"); // highest observed transport phase
    expect(confirmedAbsent.status).toBe("retry-needed");
    expect(confirmedAbsent.failure?.kind).toBe("not-admitted");
    expect(deliveryAction(confirmedAbsent)).toBe("retry");

    const ready = retry(confirmedAbsent, 125);
    expect(ready.status).toBe("ready");
    const replayed = send(ready, true, 126);
    expect(replayed.phase).toBe("sent");
    expect(replayed.status).toBe("awaiting-ack");
    expect(replayed.attempts).toBe(2);
    expect(replayed.lastAttemptAt).toBe(126);
    expect(replayed.sentAt).toBe(126);
    expect(replayed.clientId).toBe(written.clientId);
    expect(replayed.turnId).toBe(written.turnId);
    expect(replayed.conversationId).toBe(written.conversationId);
    expect(replayed.target).toBe(written.target);
    expect(replayed.payload).toBe(written.payload);
    expect(receipt(replayed, "acked-by-bridge", 127).phase).toBe("acked-by-bridge");
  });

  test("disconnect before send is retryable, but after send needs durable reconciliation", () => {
    const initial = queued();
    const droppedBefore = reduceDelivery(initial, { ...deliveryIdentity(initial), type: "disconnect", at: 110 });
    expect(droppedBefore.phase).toBe("queued");
    expect(droppedBefore.status).toBe("retry-needed");
    expect(droppedBefore.failure?.kind).toBe("disconnected");
    expect(deliveryAction(droppedBefore)).toBe("retry");

    const written = send(retry(droppedBefore, 111), true, 112);
    const droppedAfter = reduceDelivery(written, { ...deliveryIdentity(written), type: "disconnect", at: 115 });
    expect(droppedAfter.phase).toBe("sent");
    expect(droppedAfter.status).toBe("reconcile-required");
    expect(droppedAfter.payload).toBe(initial.payload);
    expect(droppedAfter.clientId).toBe(initial.clientId);
    expect(retry(droppedAfter, 120)).toBe(droppedAfter);
    const lateAck = receipt(droppedAfter, "acked-by-bridge", 114);
    expect(lateAck.phase).toBe("acked-by-bridge");
    expect(lateAck.status).toBe("accepted");
    expect(lateAck.updatedAt).toBe(115);
    expect(lateAck.failure).toBeUndefined();
  });

  test("explicit rejection is terminal and distinct from an unconfirmed admission", () => {
    const written = send(queued(), true, 101);
    const rejected = reduceDelivery(written, {
      ...deliveryIdentity(written), type: "rejected", message: "Denied by admission policy", at: 102,
    });
    expect(rejected.phase).toBe("sent");
    expect(rejected.status).toBe("rejected");
    expect(rejected.failure).toEqual({
      kind: "rejected", message: "Denied by admission policy", at: 102,
    });
    expect(deliveryAction(rejected)).toBe("none");
    expect(retry(rejected, 103)).toBe(rejected);
    expect(receipt(rejected, "started", 104)).toBe(rejected);
    expect(timeout(rejected, 105)).toBe(rejected);

    const unknown = timeout(written, 110);
    const rejectedByLookup = reconcile(unknown, "rejected", 111);
    expect(rejectedByLookup.status).toBe("rejected");
    expect(rejectedByLookup.failure?.kind).toBe("rejected");
    expect(reconcile(unknown, "acked-by-bridge", 112).phase).toBe("acked-by-bridge");
    expect(reconcile(unknown, "started", 112).phase).toBe("started");
  });

  test("payload, target, attachments and IDs are snapshotted and readonly", () => {
    const target: {
      harness: string;
      hostId: string;
      profileId: string;
      sessionId: string;
      cwd: string;
      mode: "queue" | "steer";
    } = { harness: "hermes", hostId: "original", profileId: "p", sessionId: "s", cwd: "/tmp", mode: "steer" };
    const attachment = { id: "b".repeat(32), name: "original.txt", mime: "text/plain", size: 3 };
    const items = [attachment];
    const initial = createDelivery({
      clientId: "c", turnId: "t", conversationId: "v", target,
      payload: { text: "Original text", attachments: items, summariesEnabled: false }, at: 0,
    });
    target.hostId = "changed";
    target.mode = "queue";
    attachment.name = "changed.txt";
    items.push({ id: "c".repeat(32), name: "extra.txt", mime: "text/plain", size: 1 });

    expect(initial.target.hostId).toBe("original");
    expect(initial.target.mode).toBe("steer");
    expect(initial.payload.attachments).toEqual([
      { id: "b".repeat(32), name: "original.txt", mime: "text/plain", size: 3 },
    ]);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.target)).toBe(true);
    expect(Object.isFrozen(initial.payload)).toBe(true);
    expect(Object.isFrozen(initial.payload.attachments)).toBe(true);
    expect(Object.isFrozen(initial.payload.attachments?.[0])).toBe(true);
    const written = send(initial, true, 1);
    expect(written.payload).toBe(initial.payload);
    expect(written.target).toBe(initial.target);
    expect(Object.isFrozen(written)).toBe(true);
  });

  test("invalid creation timestamps/identities and impossible or stale events fail closed", () => {
    const initial = queued();
    expect(() => createDelivery({ ...deliveryIdentity(initial), payload: initial.payload, at: Infinity })).toThrow();
    expect(() => createDelivery({ ...deliveryIdentity(initial), clientId: "", payload: initial.payload, at: 0 })).toThrow();
    expect(() => createDelivery({ ...deliveryIdentity(initial), target: { harness: "" }, payload: initial.payload, at: 0 })).toThrow();
    const written = send(initial, true, 110);
    for (const at of [NaN, Infinity, -1, 99]) {
      expect(reduceDelivery(written, { ...deliveryIdentity(written), type: "receipt", stage: "started", at })).toBe(written);
      expect(timeout(written, at)).toBe(written);
    }
    expect(reconcile(written, "not-admitted", 111)).toBe(written); // no uncertainty
    expect(retry(written, 112)).toBe(written);
    const uncertain = timeout(written, 120);
    expect(reconcile(uncertain, "not-admitted", 119)).toBe(uncertain); // stale lookup
    const retryNeeded = reconcile(uncertain, "not-admitted", 121);
    expect(retry(retryNeeded, 120)).toBe(retryNeeded); // stale local action
    const ready = retry(retryNeeded, 122);
    expect(send(ready, true, 121)).toBe(ready); // stale socket callback
    expect(reduceDelivery(ready, { ...deliveryIdentity(ready), type: "disconnect", at: 121 })).toBe(ready);
  });
});
