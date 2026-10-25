import { describe, expect, test } from "bun:test";
import {
  createPermissionsStore,
  type PermissionDecision,
  type PermissionOption,
  type PermissionRequest,
  type PermissionScope,
} from "./permissions";

function clock(start = 1_000) {
  interface Scheduled {
    at: number;
    run: () => void;
    cancelled: boolean;
  }
  let time = start;
  const scheduled: Scheduled[] = [];
  return {
    now: () => time,
    schedule(run: () => void, delay: number) {
      const task: Scheduled = { at: time + delay, run, cancelled: false };
      scheduled.push(task);
      return () => { task.cancelled = true; };
    },
    advance(ms: number) {
      const end = time + ms;
      while (true) {
        const due = scheduled.filter(task => !task.cancelled && task.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.cancelled = true;
        time = due.at;
        due.run();
      }
      time = end;
    },
    active: () => scheduled.filter(task => !task.cancelled).length,
  };
}

const options: PermissionOption[] = [
  { optionId: "yes-once", name: "Allow once", kind: "allow_once" },
  { optionId: "no-once", name: "Reject once", kind: "reject_once" },
];

function request(
  sessionId = "session-1",
  turnId = "turn-1",
  requestId = "request-1",
  deadlineAt = 61_000,
): PermissionRequest {
  return {
    type: "permission_request",
    requestId,
    turnId,
    sessionId,
    options: options.map(option => ({ ...option })),
    deadlineAt,
  };
}

function scope(conversationId = "chat-1", sessionId = "session-1", turnId = "turn-1", requestId = "request-1"): PermissionScope {
  return { conversationId, sessionId, turnId, requestId };
}

describe("conversation-scoped ACP Needs OK store", () => {
  test("two chats, sessions and turns may reuse request IDs without cross-talk", () => {
    const time = clock();
    const permissions = createPermissionsStore({ sendDecision: () => {}, now: time.now, schedule: time.schedule });
    expect(permissions.receiveRequest("chat-1", request())).toBe(true);
    expect(permissions.receiveRequest("chat-2", request())).toBe(true);
    expect(permissions.receiveRequest("chat-1", request("session-2"))).toBe(true);
    expect(permissions.receiveRequest("chat-1", request("session-1", "turn-2"))).toBe(true);

    expect(permissions.pendingCount()).toBe(4);
    expect(permissions.pendingCount("chat-1")).toBe(3);
    expect(permissions.pendingForConversation("chat-2")).toHaveLength(1);
    expect(permissions.recordFor(scope("chat-2"))?.sessionId).toBe("session-1");

    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", turnId: "turn-1", requestId: "request-1", outcome: "denied",
    })).toBe(true);
    expect(permissions.pendingCount("chat-1")).toBe(2);
    expect(permissions.pendingCount("chat-2")).toBe(1);
    expect(permissions.recordFor(scope("chat-1"))?.phase).toBe("denied");
    expect(permissions.recordFor(scope("chat-2"))?.phase).toBe("pending");
    expect(permissions.recordFor(scope("chat-1", "session-1", "turn-2"))?.phase).toBe("pending");
    expect(permissions.recordFor(scope("chat-1", "session-2"))?.phase).toBe("pending");
    permissions.dispose();
  });

  test("composite identities cannot collide when values contain delimiters", () => {
    const time = clock();
    const permissions = createPermissionsStore({ sendDecision: () => {}, now: time.now, schedule: time.schedule });
    const first = request("s", "t|r", "x");
    const second = request("s|t", "r", "x");
    permissions.receiveRequest("chat", first);
    permissions.receiveRequest("chat", second);
    expect(permissions.pendingCount("chat")).toBe(2);
    expect(permissions.recordFor(scope("chat", "s", "t|r", "x"))).toBeDefined();
    expect(permissions.recordFor(scope("chat", "s|t", "r", "x"))).toBeDefined();
    permissions.dispose();
  });

  test("a tap sends the exact offered option once; send is not approval", async () => {
    const time = clock();
    const sends: { scope: PermissionScope; decision: PermissionDecision }[] = [];
    const permissions = createPermissionsStore({
      now: time.now,
      schedule: time.schedule,
      sendDecision: (where, decision) => { sends.push({ scope: where, decision }); },
    });
    permissions.receiveRequest("chat-1", request());
    expect(await permissions.decide(scope(), "invented-option")).toBe(false);
    const first = permissions.decide(scope(), "yes-once");
    const duplicate = permissions.decide(scope(), "yes-once");
    expect(permissions.recordFor(scope())?.phase).toBe("deciding");
    expect(permissions.recordFor(scope())?.chosenOptionId).toBe("yes-once");
    expect(permissions.pendingCount()).toBe(1);
    expect(await first).toBe(true);
    expect(await duplicate).toBe(false);
    expect(sends).toEqual([{
      scope: scope(),
      decision: { type: "permission_decision", turnId: "turn-1", requestId: "request-1", optionId: "yes-once" },
    }]);
    expect(permissions.recordFor(scope())?.phase).toBe("deciding");

    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", turnId: "turn-1", requestId: "request-1",
      outcome: "allowed", optionId: "yes-once",
    })).toBe(true);
    expect(permissions.pendingCount()).toBe(0);
    expect(permissions.recordFor(scope())).toMatchObject({
      phase: "allowed", settledBy: "bridge", resolvedOptionId: "yes-once",
    });
    expect(await permissions.decide(scope(), "no-once")).toBe(false);
    expect(sends).toHaveLength(1);
    permissions.dispose();
  });

  test("an explicit rejection option is sent intact and only the bridge denies", async () => {
    const time = clock();
    const sent: PermissionDecision[] = [];
    const permissions = createPermissionsStore({
      now: time.now, schedule: time.schedule,
      sendDecision: (_, decision) => { sent.push(decision); },
    });
    permissions.receiveRequest("chat-1", request());
    expect(await permissions.decide(scope(), "no-once")).toBe(true);
    expect(sent[0]?.optionId).toBe("no-once");
    expect(permissions.recordFor(scope())?.phase).toBe("deciding");
    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", turnId: "turn-1", requestId: "request-1",
      outcome: "allowed", optionId: "no-once",
    })).toBe(false);
    expect(permissions.recordFor(scope())?.phase).toBe("deciding");
    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", turnId: "turn-1", requestId: "request-1",
      outcome: "denied", optionId: "no-once",
    })).toBe(true);
    expect(permissions.recordFor(scope())?.phase).toBe("denied");
    expect(permissions.pendingCount()).toBe(0);
    permissions.dispose();
  });

  test("wrong conversation, session, turn, request, or offered option cannot settle another card", () => {
    const time = clock();
    const permissions = createPermissionsStore({ sendDecision: () => {}, now: time.now, schedule: time.schedule });
    permissions.receiveRequest("chat-1", request());
    const resolution = {
      type: "permission_resolved",
      requestId: "request-1", turnId: "turn-1", outcome: "allowed", optionId: "yes-once",
    };
    expect(permissions.receiveResolution("chat-2", "session-1", resolution)).toBe(false);
    expect(permissions.receiveResolution("chat-1", "session-2", resolution)).toBe(false);
    expect(permissions.receiveResolution("chat-1", "session-1", { ...resolution, turnId: "turn-2" })).toBe(false);
    expect(permissions.receiveResolution("chat-1", "session-1", { ...resolution, requestId: "request-2" })).toBe(false);
    expect(permissions.receiveResolution("chat-1", "session-1", { ...resolution, optionId: "forged" })).toBe(false);
    expect(permissions.recordFor(scope())?.phase).toBe("pending");
    expect(permissions.pendingCount()).toBe(1);
    permissions.dispose();
  });

  test("replay is idempotent and stale/conflicting results never overwrite a bridge outcome", () => {
    const time = clock();
    const permissions = createPermissionsStore({ sendDecision: () => {}, now: time.now, schedule: time.schedule });
    const original = request();
    permissions.receiveRequest("chat-1", original);
    expect(permissions.receiveRequest("chat-1", request())).toBe(true);
    expect(permissions.pendingCount()).toBe(1);
    expect(permissions.receiveRequest("chat-1", { ...original, deadlineAt: 100_000 })).toBe(false);
    expect(permissions.receiveRequest("chat-1", {
      ...original, options: [{ optionId: "different", name: "Different", kind: "allow_once" }],
    })).toBe(false);
    permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1", outcome: "allowed",
    });
    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1", outcome: "timeout",
    })).toBe(false);
    permissions.receiveRequest("chat-1", request());
    expect(permissions.recordFor(scope())?.phase).toBe("allowed");
    expect(permissions.pendingCount()).toBe(0);
    permissions.dispose();
  });

  test("deadline expires an unresolved request, retains timeout, and does not reopen on replay", async () => {
    const time = clock();
    const sent: PermissionDecision[] = [];
    const permissions = createPermissionsStore({
      now: time.now, schedule: time.schedule,
      sendDecision: (_, decision) => { sent.push(decision); },
    });
    permissions.receiveRequest("chat-1", request());
    expect(time.active()).toBe(1);
    time.advance(59_999);
    expect(permissions.pendingCount()).toBe(1);
    time.advance(1);
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "timeout", settledBy: "deadline" });
    expect(permissions.pendingCount()).toBe(0);
    expect(time.active()).toBe(0);
    expect(await permissions.decide(scope(), "yes-once")).toBe(false);
    expect(sent).toHaveLength(0);
    expect(permissions.receiveRequest("chat-1", request())).toBe(true);
    expect(permissions.recordFor(scope())?.phase).toBe("timeout");
    // Authenticated bridge resolution can correct a locally inferred deadline race.
    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1",
      outcome: "allowed", optionId: "yes-once",
    })).toBe(true);
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "allowed", settledBy: "bridge" });
    permissions.dispose();
  });

  test("transport failure stays unresolved with a visible error; explicit retry may resend", async () => {
    const time = clock();
    const sent: PermissionDecision[] = [];
    let fail = true;
    const permissions = createPermissionsStore({
      now: time.now, schedule: time.schedule,
      sendDecision: async (_, decision) => {
        sent.push(decision);
        if (fail) throw new Error("offline");
      },
    });
    permissions.receiveRequest("chat-1", request());
    expect(await permissions.decide(scope(), "yes-once")).toBe(false);
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "pending", error: "transport_failed" });
    expect(permissions.pendingCount()).toBe(1);
    permissions.receiveRequest("chat-1", request());
    expect(permissions.recordFor(scope())?.error).toBe("transport_failed");
    fail = false;
    expect(await permissions.decide(scope(), "yes-once")).toBe(true);
    expect(sent.map(decision => decision.optionId)).toEqual(["yes-once", "yes-once"]);
    expect(permissions.recordFor(scope())?.phase).toBe("deciding");
    permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1",
      outcome: "denied",
    });
    expect(permissions.recordFor(scope())?.phase).toBe("denied");
    permissions.dispose();
  });

  test("late failed send cannot undo a bridge resolution or a disconnect", async () => {
    const time = clock();
    let rejectTransport: ((reason?: unknown) => void) | undefined;
    const pendingSend = new Promise<void>((_resolve, reject) => { rejectTransport = reject; });
    const permissions = createPermissionsStore({
      now: time.now, schedule: time.schedule, sendDecision: () => pendingSend,
    });
    permissions.receiveRequest("chat-1", request());
    const result = permissions.decide(scope(), "yes-once");
    permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1",
      outcome: "allowed", optionId: "yes-once",
    });
    rejectTransport?.(new Error("socket closed"));
    expect(await result).toBe(false);
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "allowed", error: null });
    permissions.dispose();
  });

  test("disconnect does not invent denial, replay reconnects, then bridge timeout settles", async () => {
    const time = clock();
    const permissions = createPermissionsStore({ sendDecision: () => {}, now: time.now, schedule: time.schedule });
    permissions.receiveRequest("chat-1", request());
    permissions.receiveRequest("chat-2", request());
    permissions.disconnect("chat-1", "session-1");
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "pending", error: "disconnected" });
    expect(permissions.pendingCount()).toBe(2);
    expect(await permissions.decide(scope(), "yes-once")).toBe(false);
    expect(permissions.recordFor(scope("chat-2"))?.error).toBeNull();
    permissions.receiveRequest("chat-1", request());
    expect(permissions.recordFor(scope())?.error).toBeNull();
    await permissions.decide(scope(), "yes-once");
    permissions.disconnect("chat-1");
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "pending", error: "disconnected" });
    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1",
      outcome: "timeout",
    })).toBe(true);
    expect(permissions.recordFor(scope())).toMatchObject({ phase: "timeout", settledBy: "bridge" });
    expect(permissions.pendingCount("chat-1")).toBe(0);
    expect(permissions.pendingCount("chat-2")).toBe(1);
    permissions.dispose();
  });

  test("rejects malformed inputs rather than creating or settling a blocker", () => {
    const time = clock();
    const permissions = createPermissionsStore({ sendDecision: () => {}, now: time.now, schedule: time.schedule });
    const originals = request();
    const malformed: unknown[] = [
      null, undefined, {}, { ...originals, type: "gate_snapshot" },
      { ...originals, requestId: "" },
      { ...originals, deadlineAt: Number.POSITIVE_INFINITY },
      { ...originals, options: [] },
      { ...originals, options: [options[0], options[0]] },
      { ...originals, options: [{ optionId: "x", kind: "unknown", name: "Fake" }] },
    ];
    for (const event of malformed) expect(permissions.receiveRequest("chat-1", event)).toBe(false);
    expect(permissions.receiveRequest("", originals)).toBe(false);
    expect(permissions.pendingCount()).toBe(0);
    expect(permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1", outcome: "allowed",
    })).toBe(false);
    permissions.dispose();
  });

  test("store subscriptions receive transitions; disposal cancels timers and stops all mutations", async () => {
    const time = clock();
    const sent: PermissionDecision[] = [];
    const permissions = createPermissionsStore({
      now: time.now, schedule: time.schedule,
      sendDecision: (_, decision) => { sent.push(decision); },
    });
    let notifications = 0;
    const unsubscribe = permissions.state.subscribe(() => { notifications += 1; });
    permissions.receiveRequest("chat-1", request());
    expect(notifications).toBe(1);
    unsubscribe();
    permissions.receiveResolution("chat-1", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1", outcome: "denied",
    });
    expect(notifications).toBe(1);
    permissions.receiveRequest("chat-2", request());
    expect(time.active()).toBe(1);
    permissions.dispose();
    expect(time.active()).toBe(0);
    expect(permissions.pendingCount()).toBe(0);
    expect(permissions.recordFor(scope("chat-2"))).toBeUndefined();
    time.advance(120_000);
    expect(permissions.receiveRequest("chat-1", request())).toBe(false);
    expect(permissions.receiveResolution("chat-2", "session-1", {
      type: "permission_resolved", requestId: "request-1", turnId: "turn-1", outcome: "allowed",
    })).toBe(false);
    expect(await permissions.decide(scope("chat-2"), "yes-once")).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
