import { describe, expect, test } from "bun:test";
import {
  ACK_TIMEOUT_MS,
  DELIVERY_OUTCOME_UNCONFIRMED,
  DeliveryDeadlineController,
  NOT_SENT_RETRY_LABEL,
  type DeliveryDeadlineClock,
  type DeliveryDeadlineEvent,
} from "./delivery-deadline";

interface ScheduledTask {
  id: number;
  dueAt: number;
  callback: () => void;
}

/** Virtual time, including a hook that deliberately fires cancelled timers. */
class FakeClock implements DeliveryDeadlineClock {
  private time = 0;
  private nextId = 1;
  private readonly scheduled = new Map<number, ScheduledTask>();
  readonly callbacks: Array<() => void> = [];

  now(): number {
    return this.time;
  }

  setTimer(callback: () => void, delayMs: number): () => void {
    const id = this.nextId++;
    this.callbacks.push(callback);
    this.scheduled.set(id, { id, dueAt: this.time + delayMs, callback });
    return () => {
      this.scheduled.delete(id);
    };
  }

  advance(ms: number): void {
    const target = this.time + ms;
    while (true) {
      const next = [...this.scheduled.values()]
        .filter((task) => task.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!next) break;
      this.scheduled.delete(next.id);
      this.time = next.dueAt;
      next.callback();
    }
    this.time = target;
  }

  forceOldCallback(index: number): void {
    this.callbacks[index]?.();
  }

  get timerCount(): number {
    return this.scheduled.size;
  }
}

function fixture(timeoutMs?: number): {
  clock: FakeClock;
  events: DeliveryDeadlineEvent[];
  controller: DeliveryDeadlineController;
} {
  const clock = new FakeClock();
  const events: DeliveryDeadlineEvent[] = [];
  const controller = new DeliveryDeadlineController((event) => {
    events.push(event);
  }, { clock, timeoutMs });
  return { clock, events, controller };
}

type RetryNeededEvent = Extract<DeliveryDeadlineEvent, { type: "retry-needed" }>;

function retries(events: DeliveryDeadlineEvent[]): RetryNeededEvent[] {
  return events.filter((event): event is RetryNeededEvent => event.type === "retry-needed");
}

describe("DeliveryDeadlineController", () => {
  test("10s default: timeout minus one millisecond is still waiting", () => {
    const { clock, events, controller } = fixture();
    expect(ACK_TIMEOUT_MS).toBe(10_000);
    const generation = controller.beginGeneration();
    expect(controller.trackSent("turn-1", generation)).toBe(true);
    expect(events).toEqual([
      { type: "waiting-for-ack", id: "turn-1", generation, deadlineAt: ACK_TIMEOUT_MS },
    ]);
    clock.advance(ACK_TIMEOUT_MS - 1);
    expect(retries(events)).toEqual([]);
    expect(controller.pendingIds()).toEqual(["turn-1"]);
    clock.advance(1);
    expect(retries(events)).toEqual([{
      type: "retry-needed",
      id: "turn-1",
      generation,
      reason: "ack-timeout",
      label: NOT_SENT_RETRY_LABEL,
      explanation: DELIVERY_OUTCOME_UNCONFIRMED,
    }]);
    expect(NOT_SENT_RETRY_LABEL).toBe("Not sent · Retry");
    expect(DELIVERY_OUTCOME_UNCONFIRMED).toContain("may have received");
    clock.advance(60_000);
    expect(retries(events)).toHaveLength(1);
    expect(clock.timerCount).toBe(0);
    // No network/send callback exists: only waiting/retry status was emitted.
    expect(events.map((event) => event.type)).toEqual(["waiting-for-ack", "retry-needed"]);
  });

  test("ack before deadline only cancels the matching turn timer", () => {
    const { clock, events, controller } = fixture();
    const generation = controller.beginGeneration();
    controller.trackSent("a", generation);
    clock.advance(200);
    controller.trackSent("b", generation);
    expect(controller.ack("a", generation)).toBe(true);
    expect(controller.ack("a", generation)).toBe(false);
    expect(controller.ack("missing", generation)).toBe(false);
    expect(controller.pendingIds()).toEqual(["b"]);
    clock.advance(9_800);
    expect(retries(events)).toEqual([]);
    clock.advance(200);
    expect(retries(events).map((event) => event.id)).toEqual(["b"]);
    expect(events.filter((event) => event.type === "acknowledged")).toEqual([
      { type: "acknowledged", id: "a", generation },
    ]);
  });

  test("late acknowledgement reconciles a timed-out id once", () => {
    const { clock, events, controller } = fixture(12);
    const generation = controller.beginGeneration();
    controller.trackSent("late", generation);
    clock.advance(12);
    expect(retries(events)).toHaveLength(1);
    expect(controller.ack("late", generation)).toBe(true);
    expect(controller.ack("late", generation)).toBe(false);
    expect(controller.pendingIds()).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "acknowledged", id: "late", generation });
    clock.advance(999);
    expect(retries(events)).toHaveLength(1);
  });

  test("a timer fired early uses the injected clock and re-arms the remainder", () => {
    const { clock, events, controller } = fixture(10);
    const generation = controller.beginGeneration();
    controller.trackSent("early", generation);
    clock.advance(9);
    clock.forceOldCallback(0);
    expect(retries(events)).toEqual([]);
    expect(clock.timerCount).toBe(1);
    clock.advance(1);
    expect(retries(events).map((event) => event.id)).toEqual(["early"]);
  });

  test("socket drop marks every unresolved turn immediately, exactly once", () => {
    const { clock, events, controller } = fixture();
    const generation = controller.beginGeneration();
    controller.trackSent("a", generation);
    controller.trackSent("b", generation);
    controller.trackSent("c", generation);
    controller.ack("b", generation);
    controller.disconnect(generation);
    controller.disconnect(generation);
    clock.advance(ACK_TIMEOUT_MS * 2);
    expect(retries(events).map((event) => [event.id, event.reason])).toEqual([
      ["a", "socket-drop"], ["c", "socket-drop"],
    ]);
    expect(clock.timerCount).toBe(0);
    expect(controller.trackSent("new", generation)).toBe(false);
    expect(controller.pendingIds()).toEqual(["a", "c"]);
  });

  test("a timeout followed by disconnection never duplicates the retry-needed event", () => {
    const { clock, events, controller } = fixture(10);
    const generation = controller.beginGeneration();
    controller.trackSent("already-due", generation);
    clock.advance(5);
    controller.trackSent("not-yet-due", generation);
    clock.advance(5);
    expect(retries(events).map((event) => [event.id, event.reason])).toEqual([
      ["already-due", "ack-timeout"],
    ]);
    controller.disconnect(generation);
    expect(retries(events).map((event) => [event.id, event.reason])).toEqual([
      ["already-due", "ack-timeout"], ["not-yet-due", "socket-drop"],
    ]);
    clock.advance(100);
    expect(retries(events)).toHaveLength(2);
    expect(clock.timerCount).toBe(0);
  });

  test("late ack after socket drop can reconcile before the next generation", () => {
    const { events, controller } = fixture();
    const generation = controller.beginGeneration();
    controller.trackSent("possibly-received", generation);
    controller.disconnect(generation);
    expect(controller.ack("possibly-received", generation)).toBe(true);
    expect(events.at(-1)).toEqual({
      type: "acknowledged", id: "possibly-received", generation,
    });
    expect(controller.pendingIds()).toEqual([]);
  });

  test("old socket callbacks and ack cannot mutate reconnected send of the same id", () => {
    const { clock, events, controller } = fixture(10);
    const oldGeneration = controller.beginGeneration();
    controller.trackSent("stable-id", oldGeneration);
    const newGeneration = controller.beginGeneration();
    expect(newGeneration).toBe(oldGeneration + 1);
    expect(retries(events).map((event) => [event.generation, event.reason])).toEqual([
      [oldGeneration, "socket-drop"],
    ]);
    controller.trackSent("stable-id", newGeneration);
    clock.forceOldCallback(0); // simulate a queued callback after cancellation
    controller.disconnect(oldGeneration); // late socket onclose
    expect(controller.ack("stable-id", oldGeneration)).toBe(false);
    expect(controller.pendingIds()).toEqual(["stable-id"]);
    expect(retries(events)).toHaveLength(1);
    clock.advance(10);
    expect(retries(events).map((event) => [event.generation, event.reason])).toEqual([
      [oldGeneration, "socket-drop"], [newGeneration, "ack-timeout"],
    ]);
    expect(controller.ack("stable-id", newGeneration)).toBe(true);
  });

  test("old timers cannot affect another id on the new generation", () => {
    const { clock, events, controller } = fixture(10);
    const oldGeneration = controller.beginGeneration();
    controller.trackSent("old", oldGeneration);
    const newGeneration = controller.beginGeneration();
    controller.trackSent("new", newGeneration);
    clock.forceOldCallback(0);
    expect(controller.pendingIds()).toEqual(["new"]);
    expect(retries(events).map((event) => event.id)).toEqual(["old"]);
    expect(controller.ack("new", newGeneration)).toBe(true);
    clock.advance(10);
    expect(retries(events).map((event) => event.id)).toEqual(["old"]);
  });

  test("explicit retry preserves the id and resets deadline without a stale timer", () => {
    const { clock, events, controller } = fixture(10);
    const generation = controller.beginGeneration();
    controller.trackSent("same-id", generation);
    clock.advance(9);
    expect(controller.trackSent("same-id", generation)).toBe(true);
    clock.forceOldCallback(0);
    expect(retries(events)).toEqual([]);
    clock.advance(1); // original deadline
    expect(retries(events)).toEqual([]);
    clock.advance(9); // actual retry deadline
    expect(retries(events).map((event) => event.id)).toEqual(["same-id"]);
    expect(events.filter((event) => event.type === "waiting-for-ack")).toHaveLength(2);
  });

  test("dispose cancels all timers without emitting retries; repeated dispose is harmless", () => {
    const { clock, events, controller } = fixture(10);
    const generation = controller.beginGeneration();
    controller.trackSent("a", generation);
    controller.trackSent("b", generation);
    controller.dispose();
    controller.dispose();
    expect(clock.timerCount).toBe(0);
    expect(controller.pendingIds()).toEqual([]);
    clock.forceOldCallback(0);
    clock.advance(100);
    controller.disconnect(generation);
    expect(controller.ack("a", generation)).toBe(false);
    expect(controller.trackSent("c", generation)).toBe(false);
    expect(retries(events)).toEqual([]);
    expect(() => controller.beginGeneration()).toThrow("disposed");
  });

  test("rejects invalid timeout values and invalid or stale sends", () => {
    expect(() => fixture(0)).toThrow("finite positive");
    expect(() => fixture(-1)).toThrow("finite positive");
    expect(() => fixture(Number.NaN)).toThrow("finite positive");
    expect(() => fixture(Infinity)).toThrow("finite positive");
    const { controller, events } = fixture();
    expect(controller.trackSent("offline", 0)).toBe(false);
    const generation = controller.beginGeneration();
    expect(controller.trackSent(" ", generation)).toBe(false);
    expect(controller.trackSent("old-epoch", generation - 1)).toBe(false);
    expect(controller.ack("old-epoch", generation)).toBe(false);
    expect(events).toEqual([]);
  });
});
