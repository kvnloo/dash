import { expect, test } from "bun:test";
import {
  PERMISSION_TIMEOUT_MS,
  PermissionBroker,
  type AcpPermissionResponse,
  type PermissionBrokerOption,
  type PermissionNotice,
  type PermissionScheduler,
  type PermissionScope,
} from "./permission-broker";

type NoticeRecord = { recipient: string; notice: PermissionNotice };

const scope: PermissionScope = {
  authenticatedPrincipal: "paired-owner-A",
  turnId: "turn-1",
  requestId: "rpc-7",
  sessionId: "acp-session-1",
};

const options: PermissionBrokerOption[] = [
  { optionId: "yes", name: "Allow this time", kind: "allow_once" },
  { optionId: "no", name: "Reject this time", kind: "reject_once" },
];

function fakeClock(startAt = 0) {
  let now = startAt;
  let next = 0;
  const tasks = new Map<number, { at: number; run(): void }>();
  const scheduler: PermissionScheduler = {
    now: () => now,
    schedule(run, delayMs) {
      const id = ++next;
      tasks.set(id, { at: now + delayMs, run });
      return () => { tasks.delete(id); };
    },
  };
  function advance(ms: number): void {
    const target = now + ms;
    for (;;) {
      let nextDue: { id: number; at: number; run(): void } | undefined;
      for (const [id, task] of tasks) {
        if (task.at <= target && (!nextDue || task.at < nextDue.at)) {
          nextDue = { id, at: task.at, run: task.run };
        }
      }
      if (!nextDue) break;
      tasks.delete(nextDue.id);
      now = nextDue.at;
      nextDue.run();
    }
    now = target;
  }
  return {
    scheduler,
    advance,
    jump(ms: number) { now += ms; },
    remaining: () => tasks.size,
  };
}

function capture(
  broker: PermissionBroker,
  key: PermissionScope = scope,
  offered: readonly PermissionBrokerOption[] = options,
) {
  const notices: NoticeRecord[] = [];
  const responses: AcpPermissionResponse[] = [];
  const registered = broker.register({
    ...key, options: offered,
    respond(response) { responses.push(response); },
    notify(recipient, notice) { notices.push({ recipient, notice }); },
  });
  return { registered, notices, responses };
}

test("approve exact offered allow_once sends selected ACP result and allowed notice exactly once", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const request = capture(broker);

  expect(request.registered).toBe(true);
  expect(request.notices).toEqual([{
    recipient: scope.authenticatedPrincipal,
    notice: {
      type: "permission_request",
      requestId: scope.requestId,
      turnId: scope.turnId,
      sessionId: scope.sessionId,
      options,
      deadlineAt: PERMISSION_TIMEOUT_MS,
    },
  }]);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(true);
  expect(request.responses).toEqual([{ outcome: { outcome: "selected", optionId: "yes" } }]);
  expect(request.notices.at(-1)).toEqual({
    recipient: scope.authenticatedPrincipal,
    notice: {
      type: "permission_resolved", requestId: scope.requestId,
      turnId: scope.turnId, outcome: "allowed", optionId: "yes",
    },
  });
  expect(broker.pendingCount(scope.authenticatedPrincipal)).toBe(0);
  expect(clock.remaining()).toBe(0);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(false);
  clock.advance(PERMISSION_TIMEOUT_MS * 2);
  expect(request.responses).toHaveLength(1);
  expect(request.notices).toHaveLength(2);
});

test("explicit rejection selects the exact reject choice, not cancellation or approval", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const offered: PermissionBrokerOption[] = [
    { optionId: "allow-forever", name: "Always allow", kind: "allow_always" },
    { optionId: "reject-forever", name: "Always reject", kind: "reject_always" },
  ];
  const request = capture(broker, scope, offered);
  expect(broker.decide({ ...scope, optionId: "reject-forever" })).toBe(true);
  expect(request.responses).toEqual([{
    outcome: { outcome: "selected", optionId: "reject-forever" },
  }]);
  expect(request.notices.at(-1)?.notice).toMatchObject({
    type: "permission_resolved", outcome: "denied", optionId: "reject-forever",
  });
  expect(clock.remaining()).toBe(0);
});

test("deny prefers reject_once; when no reject is offered it safely cancels", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const first = capture(broker, scope, [
    { optionId: "always-no", name: "Reject always", kind: "reject_always" },
    { optionId: "always-yes", name: "Allow always", kind: "allow_always" },
    { optionId: "once-no", name: "Reject once", kind: "reject_once" },
  ]);
  expect(broker.deny(scope)).toBe(true);
  expect(first.responses).toEqual([{ outcome: { outcome: "selected", optionId: "once-no" } }]);
  const secondScope = { ...scope, requestId: "rpc-without-reject" };
  const second = capture(broker, secondScope, [
    { optionId: "yes", name: "Allow once", kind: "allow_once" },
  ]);
  expect(broker.deny(secondScope)).toBe(true);
  expect(second.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(second.notices.at(-1)?.notice).toMatchObject({ outcome: "denied" });
  expect(clock.remaining()).toBe(0);
});

test("wrong principal, turn, request, session or nonoffered option never settles the request", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const request = capture(broker);
  expect(broker.decide({ ...scope, authenticatedPrincipal: "other", optionId: "yes" })).toBe(false);
  expect(broker.decide({ ...scope, turnId: "other", optionId: "yes" })).toBe(false);
  expect(broker.decide({ ...scope, requestId: "other", optionId: "yes" })).toBe(false);
  expect(broker.decide({ ...scope, sessionId: "other", optionId: "yes" })).toBe(false);
  expect(broker.decide({ ...scope, optionId: "yes-but-not-offered" })).toBe(false);
  expect(broker.deny({ ...scope, authenticatedPrincipal: "other" })).toBe(false);
  expect(broker.cancel({ ...scope, sessionId: "other" })).toBe(false);
  expect(broker.pendingCount("other")).toBe(0);
  expect(broker.pendingCount(scope.authenticatedPrincipal)).toBe(1);
  expect(request.responses).toHaveLength(0);
  expect(request.notices).toHaveLength(1);
  expect(clock.remaining()).toBe(1);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(true);
});

test("fake-clock deadline cancels once and exposes timeout; late decisions fail", () => {
  const clock = fakeClock(4_000);
  const broker = new PermissionBroker(clock.scheduler);
  const request = capture(broker);
  expect(request.notices[0]?.notice).toMatchObject({ deadlineAt: 4_000 + PERMISSION_TIMEOUT_MS });
  clock.advance(PERMISSION_TIMEOUT_MS - 1);
  expect(request.responses).toHaveLength(0);
  clock.advance(1);
  expect(request.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(request.notices.at(-1)?.notice).toMatchObject({
    type: "permission_resolved", outcome: "timeout",
  });
  expect(request.notices).toHaveLength(2);
  expect(clock.remaining()).toBe(0);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(false);
  expect(broker.deny(scope)).toBe(false);
  clock.advance(PERMISSION_TIMEOUT_MS);
  expect(request.responses).toHaveLength(1);
});

test("decision after wall-clock deadline fails closed even before timer callback executes", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const request = capture(broker);
  clock.jump(PERMISSION_TIMEOUT_MS + 1);
  expect(clock.remaining()).toBe(1);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(false);
  expect(request.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(request.notices.at(-1)?.notice).toMatchObject({ outcome: "timeout" });
  clock.advance(0);
  expect(request.responses).toHaveLength(1);
  expect(clock.remaining()).toBe(0);
});

test("concurrent principals with identical ACP ids are isolated, including replay notifier", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const other = { ...scope, authenticatedPrincipal: "paired-owner-B" };
  const first = capture(broker);
  const second = capture(broker, other);
  const replayed: NoticeRecord[] = [];

  expect(broker.replay("unauthenticated-person", (recipient, notice) => {
    replayed.push({ recipient, notice });
  })).toBe(0);
  expect(broker.replay(other.authenticatedPrincipal, (recipient, notice) => {
    replayed.push({ recipient, notice });
  })).toBe(1);
  expect(replayed).toHaveLength(1);
  expect(replayed[0]?.recipient).toBe(other.authenticatedPrincipal);
  expect(first.notices).toHaveLength(1);
  expect(second.notices).toHaveLength(1);
  expect(clock.remaining()).toBe(2);

  expect(broker.decide({ ...other, optionId: "no" })).toBe(true);
  expect(second.responses).toEqual([{ outcome: { outcome: "selected", optionId: "no" } }]);
  expect(replayed.at(-1)?.notice).toMatchObject({ outcome: "denied", optionId: "no" });
  expect(second.notices).toHaveLength(1); // Old socket notifier was replaced.
  expect(first.responses).toHaveLength(0);
  expect(broker.pendingCount(scope.authenticatedPrincipal)).toBe(1);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(true);
  expect(first.responses).toEqual([{ outcome: { outcome: "selected", optionId: "yes" } }]);
  expect(clock.remaining()).toBe(0);
});

test("reconnect replays multiple unresolved requests without extending their deadlines", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const requestA = capture(broker, scope);
  const requestB = capture(broker, { ...scope, requestId: "rpc-8" });
  clock.advance(30_000);
  const replacement: NoticeRecord[] = [];
  expect(broker.replay(scope.authenticatedPrincipal, (recipient, notice) => {
    replacement.push({ recipient, notice });
  })).toBe(2);
  expect(replacement.map(value => value.notice)).toEqual([
    expect.objectContaining({ type: "permission_request", requestId: "rpc-7", deadlineAt: PERMISSION_TIMEOUT_MS }),
    expect.objectContaining({ type: "permission_request", requestId: "rpc-8", deadlineAt: PERMISSION_TIMEOUT_MS }),
  ]);
  expect(clock.remaining()).toBe(2);
  clock.advance(30_000);
  expect(requestA.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(requestB.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(replacement.filter(value => value.notice.type === "permission_resolved")).toHaveLength(2);
  expect(requestA.notices).toHaveLength(1);
  expect(requestB.notices).toHaveLength(1);
  expect(clock.remaining()).toBe(0);
});

test("duplicate registration cannot swap responder, options, clock, or notifier", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const offered: { optionId: string; name: string; kind: "allow_once" }[] = [
    { optionId: "original", name: "Safe original", kind: "allow_once" },
  ];
  const first = capture(broker, scope, offered);
  clock.advance(5_000);
  const duplicate = capture(broker, scope, [
    { optionId: "replacement", name: "Different", kind: "allow_once" },
  ]);
  expect(duplicate.registered).toBe(false);
  expect(clock.remaining()).toBe(1);
  const original = offered[0];
  if (original) {
    original.optionId = "mutated";
    original.name = "Mutated by caller";
  }
  expect(broker.decide({ ...scope, optionId: "replacement" })).toBe(false);
  expect(broker.decide({ ...scope, optionId: "mutated" })).toBe(false);
  const replayed: PermissionNotice[] = [];
  expect(broker.replay(scope.authenticatedPrincipal, (_recipient, notice) => {
    replayed.push(notice);
  })).toBe(1);
  expect(replayed[0]).toMatchObject({
    options: [{ optionId: "original", name: "Safe original" }],
    deadlineAt: PERMISSION_TIMEOUT_MS,
  });
  expect(broker.decide({ ...scope, optionId: "original" })).toBe(true);
  expect(first.responses).toHaveLength(1);
  expect(duplicate.responses).toHaveLength(0);
  expect(clock.remaining()).toBe(0);
});

test("JSON tuple identities avoid delimiter collisions; session scopes remain independent", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const one = { ...scope, turnId: "x|y", requestId: "z", sessionId: "same" };
  const two = { ...scope, turnId: "x", requestId: "y|z", sessionId: "same" };
  const three = { ...one, sessionId: "different" };
  const requests = [capture(broker, one), capture(broker, two), capture(broker, three)];
  expect(broker.pendingCount(scope.authenticatedPrincipal)).toBe(3);
  expect(broker.decide({ ...two, optionId: "yes" })).toBe(true);
  expect(requests.map(value => value.responses.length)).toEqual([0, 1, 0]);
  expect(broker.cancel(one)).toBe(true);
  expect(broker.cancel(three)).toBe(true);
  expect(requests.map(value => value.responses.length)).toEqual([1, 1, 1]);
  expect(clock.remaining()).toBe(0);
});

test("turn exit, principal revocation and dispose cancel outstanding work and all timers", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const otherPrincipal = { ...scope, authenticatedPrincipal: "paired-owner-B", turnId: "turn-2" };
  const first = capture(broker);
  const sameTurn = capture(broker, { ...scope, requestId: "rpc-8" });
  const otherTurn = capture(broker, { ...scope, turnId: "turn-2" });
  const unaffected = capture(broker, otherPrincipal);
  expect(clock.remaining()).toBe(4);
  expect(broker.cancelTurn(scope.authenticatedPrincipal, scope.turnId)).toBe(2);
  expect(first.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(sameTurn.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(otherTurn.responses).toHaveLength(0);
  expect(clock.remaining()).toBe(2);

  expect(broker.revoke(scope.authenticatedPrincipal)).toBe(1);
  expect(otherTurn.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(otherTurn.notices.at(-1)?.notice).toMatchObject({ outcome: "denied" });
  expect(broker.replay(scope.authenticatedPrincipal, () => {})).toBe(0);
  expect(capture(broker, { ...scope, requestId: "new" }).registered).toBe(false);
  expect(clock.remaining()).toBe(1);

  broker.dispose();
  broker.dispose();
  expect(unaffected.responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
  expect(unaffected.notices.at(-1)?.notice).toMatchObject({ outcome: "denied" });
  expect(clock.remaining()).toBe(0);
  expect(capture(broker, { ...otherPrincipal, requestId: "new" }).registered).toBe(false);
  expect(broker.pendingCount(otherPrincipal.authenticatedPrincipal)).toBe(0);
  clock.advance(PERMISSION_TIMEOUT_MS * 2);
  expect(unaffected.responses).toHaveLength(1);
});

test("reentrant and throwing callbacks cannot issue double responses or suppress resolution", () => {
  const clock = fakeClock();
  const callbackErrors: unknown[] = [];
  const broker = new PermissionBroker(clock.scheduler, error => { callbackErrors.push(error); });
  const notices: PermissionNotice[] = [];
  let attempts = 0;
  expect(broker.register({
    ...scope, options,
    respond() {
      attempts++;
      expect(broker.decide({ ...scope, optionId: "yes" })).toBe(false);
      throw new Error("ACP pipe closed");
    },
    notify(_recipient, notice) {
      notices.push(notice);
      if (notice.type === "permission_resolved") {
        expect(broker.deny(scope)).toBe(false);
      }
    },
  })).toBe(true);
  expect(broker.decide({ ...scope, optionId: "yes" })).toBe(true);
  expect(attempts).toBe(1);
  expect(notices).toHaveLength(2);
  expect(notices.at(-1)).toMatchObject({ outcome: "allowed" });
  expect(callbackErrors).toHaveLength(1);
  expect(callbackErrors[0]).toBeInstanceOf(Error);
  expect(clock.remaining()).toBe(0);
});

test("invalid identities and ambiguous or malformed choice sets fail before installing timers", () => {
  const clock = fakeClock();
  const broker = new PermissionBroker(clock.scheduler);
  const source = { ...scope, respond() {}, notify() {} };
  expect(() => broker.register({ ...source, turnId: "", options })).toThrow(/identity/);
  expect(() => broker.register({ ...source, requestId: "   ", options })).toThrow(/identity/);
  expect(() => broker.register({ ...source, options: [] })).toThrow(/1–32/);
  expect(() => broker.register({ ...source, options: [
    { optionId: "no", name: "Reject", kind: "reject_once" },
    { optionId: "no", name: "Duplicate", kind: "allow_once" },
  ] })).toThrow(/duplicate/);
  expect(() => broker.register({ ...source, options: [
    { optionId: "yes", name: "\nprivate", kind: "allow_once" },
  ] })).toThrow(/choice/);
  expect(clock.remaining()).toBe(0);
  expect(broker.pendingCount(scope.authenticatedPrincipal)).toBe(0);
  const impossibleClock = new PermissionBroker(fakeClock(Number.POSITIVE_INFINITY).scheduler);
  expect(() => capture(impossibleClock)).toThrow(/deadline/);
});
