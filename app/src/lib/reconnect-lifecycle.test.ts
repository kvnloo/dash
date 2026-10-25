import { describe, expect, test } from "bun:test";
import {
  createReconnectLifecycle,
  reconnectDelayMs,
  reconnectPresentation,
  RECONNECT_CAP_MS,
  RECONNECT_HELLO_TIMEOUT_MS,
  type ReconnectDriver,
  type ReconnectScheduler,
  type ReconnectSnapshot,
} from "./reconnect-lifecycle";

class FakeClock implements ReconnectScheduler<number> {
  time = 1_000;
  private sequence = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now = (): number => this.time;
  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  };
  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };
  pending(): number {
    return this.timers.size;
  }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let due: { id: number; at: number; callback: () => void } | undefined;
      for (const [id, timer] of this.timers) {
        if (timer.at <= end && (!due || timer.at < due.at || (timer.at === due.at && id < due.id))) {
          due = { id, ...timer };
        }
      }
      if (!due) break;
      this.time = due.at;
      this.timers.delete(due.id);
      due.callback();
    }
    this.time = end;
  }
}

function harness() {
  const clock = new FakeClock();
  const connects: number[] = [];
  const aborts: number[] = [];
  const snapshots: ReconnectSnapshot[] = [];
  const driver: ReconnectDriver = {
    connect(generation) { connects.push(generation); },
    abort(generation) { aborts.push(generation); },
    publish(snapshot) { snapshots.push(snapshot); },
  };
  const reconnect = createReconnectLifecycle(clock, driver);
  return { reconnect, clock, connects, aborts, snapshots };
}

function lastConnection(connections: number[]): number {
  const generation = connections[connections.length - 1];
  if (generation === undefined) throw new Error("Expected bridge attempt");
  return generation;
}

describe("PC bridge reconnection", () => {
  test("bounded exponential sequence doubles and saturates at 30 seconds", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start();
    expect(connects).toHaveLength(1);
    for (const delay of [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const previousCount = connects.length;
      reconnect.closed(lastConnection(connects), "PC restarted");
      expect(reconnect.snapshot().phase).toBe("waiting");
      expect((reconnect.snapshot().nextAttemptAt ?? 0) - clock.now()).toBe(delay);
      clock.advance(delay - 1);
      expect(connects).toHaveLength(previousCount);
      clock.advance(1);
      expect(connects).toHaveLength(previousCount + 1);
      expect(reconnect.snapshot().phase).toBe("connecting");
    }
    expect(reconnectDelayMs(1000000)).toBe(RECONNECT_CAP_MS);
    expect(reconnectDelayMs(Number.MAX_SAFE_INTEGER)).toBe(RECONNECT_CAP_MS);
    expect(reconnectDelayMs(-5)).toBe(500);
    reconnect.stop();
    expect(clock.pending()).toBe(0);
  });

  test("plain WebSocket open never resets failures or releases hello watchdog", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start();
    const first = lastConnection(connects);
    reconnect.socketOpen(first);
    clock.advance(RECONNECT_HELLO_TIMEOUT_MS - 1);
    expect(reconnect.snapshot().phase).toBe("connecting");
    clock.advance(1);
    expect(reconnect.snapshot()).toMatchObject({ phase: "waiting", failures: 1 });
    expect(reconnect.snapshot().reason).toContain("bridge hello");
    clock.advance(500);
    const second = lastConnection(connects);
    reconnect.socketOpen(second);
    reconnect.closed(second, "closed before authenticated hello");
    expect((reconnect.snapshot().nextAttemptAt ?? 0) - clock.now()).toBe(1000);
  });

  test("an authenticated hello resets backoff only for the current generation", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start();
    const first = lastConnection(connects);
    reconnect.closed(first, "restart");
    clock.advance(500);
    const second = lastConnection(connects);
    reconnect.authenticatedHello(first);
    expect(reconnect.snapshot().phase).toBe("connecting");
    reconnect.authenticatedHello(second);
    expect(reconnect.snapshot()).toMatchObject({ phase: "online", failures: 0 });
    expect(clock.pending()).toBe(0);
    reconnect.closed(second, "another restart");
    expect((reconnect.snapshot().nextAttemptAt ?? 0) - clock.now()).toBe(500);
  });

  test("timeout retires the socket and duplicate close cannot add a second timer", () => {
    const { reconnect, clock, connects, aborts } = harness();
    reconnect.start();
    const first = lastConnection(connects);
    clock.advance(RECONNECT_HELLO_TIMEOUT_MS);
    expect(aborts).toContain(first);
    expect(clock.pending()).toBe(1);
    reconnect.closed(first, "native onclose");
    expect(clock.pending()).toBe(1);
    clock.advance(500);
    expect(connects).toHaveLength(2);
  });

  test("background pauses pending attempts, foreground bypasses backoff", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start();
    reconnect.closed(lastConnection(connects), "screen locked");
    reconnect.background();
    expect(reconnect.snapshot()).toMatchObject({ phase: "paused", nextAttemptAt: null });
    clock.advance(90_000);
    expect(connects).toHaveLength(1);
    reconnect.foreground();
    expect(connects).toHaveLength(2);
    expect(reconnect.snapshot().phase).toBe("connecting");
  });

  test("a background start waits for a foreground launch", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start(false);
    expect(reconnect.snapshot().phase).toBe("paused");
    clock.advance(60_000);
    expect(connects).toHaveLength(0);
    reconnect.foreground();
    expect(connects).toHaveLength(1);
  });

  test("foreground during connecting replaces stale socket and async auth", () => {
    const { reconnect, connects, aborts } = harness();
    reconnect.start();
    const oldGeneration = lastConnection(connects);
    reconnect.background();
    reconnect.foreground();
    expect(aborts).toContain(oldGeneration);
    expect(connects).toHaveLength(2);
    reconnect.authenticatedHello(oldGeneration);
    reconnect.closed(oldGeneration, "stale close");
    expect(reconnect.snapshot().phase).toBe("connecting");
    reconnect.authenticatedHello(lastConnection(connects));
    expect(reconnect.snapshot().phase).toBe("online");
  });

  test("non-retryable authentication failure blocks automatic attempts until user action", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start();
    reconnect.closed(lastConnection(connects), "Bridge rejected the token", false);
    expect(reconnect.snapshot()).toMatchObject({ phase: "blocked", nextAttemptAt: null });
    clock.advance(90_000);
    reconnect.background();
    reconnect.foreground();
    expect(connects).toHaveLength(1);
    reconnect.retry();
    expect(connects).toHaveLength(2);
    expect(reconnect.snapshot()).toMatchObject({ phase: "connecting", failures: 0 });
  });

  test("manual retry resets the schedule and cancels the previous wait", () => {
    const { reconnect, clock, connects } = harness();
    reconnect.start();
    reconnect.closed(lastConnection(connects), "bridge missing");
    reconnect.retry();
    expect(connects).toHaveLength(2);
    expect(clock.pending()).toBe(1);
    reconnect.closed(lastConnection(connects), "bridge still missing");
    expect((reconnect.snapshot().nextAttemptAt ?? 0) - clock.now()).toBe(500);
    clock.advance(500);
    expect(connects).toHaveLength(3);
  });

  test("stop and new pairing invalidate old callbacks, never reconnect a forgotten host", () => {
    const { reconnect, clock, connects, aborts } = harness();
    reconnect.start();
    const first = lastConnection(connects);
    reconnect.stop();
    expect(aborts).toContain(first);
    expect(reconnect.snapshot().phase).toBe("idle");
    clock.advance(120_000);
    reconnect.closed(first, "late close");
    reconnect.authenticatedHello(first);
    reconnect.retry();
    reconnect.foreground();
    expect(connects).toHaveLength(1);
    reconnect.start();
    expect(connects).toHaveLength(2);
    reconnect.closed(first, "stale after re-pair");
    expect(reconnect.snapshot().phase).toBe("connecting");
  });

  test("synchronous connection errors become retryable instead of escaping", () => {
    const clock = new FakeClock();
    const reconnect = createReconnectLifecycle(clock, {
      connect() { throw new Error("socket factory unavailable"); },
      abort() {},
      publish() {},
    });
    reconnect.start();
    expect(reconnect.snapshot()).toMatchObject({ phase: "waiting", failures: 1, reason: "socket factory unavailable" });
    expect(clock.pending()).toBe(1);
    reconnect.stop();
  });

  test("snapshots and status messages remain truthful and externally immutable by copy", () => {
    const { reconnect, clock, connects, snapshots } = harness();
    expect(reconnectPresentation(reconnect.snapshot(), clock.now())).toBeNull();
    reconnect.start();
    const initial = reconnectPresentation(reconnect.snapshot(), clock.now());
    expect(initial?.text).toBe("Connecting to PC…");
    expect(initial?.actionLabel).toBe("Retry now");
    reconnect.closed(lastConnection(connects), "restart");
    const waiting = reconnectPresentation(reconnect.snapshot(), clock.now());
    expect(waiting?.text).toBe("PC unavailable · retrying in 1s");
    expect(waiting?.accessibilityLabel).toContain("Retry connection now");
    reconnect.background();
    expect(reconnectPresentation(reconnect.snapshot(), clock.now())?.text).toContain("Dash is active");
    reconnect.foreground();
    expect(reconnectPresentation(reconnect.snapshot(), clock.now())?.text).toBe("Reconnecting to PC…");
    reconnect.closed(lastConnection(connects), "bad token", false);
    expect(reconnectPresentation(reconnect.snapshot(), clock.now())?.action).toBe("pair");
    expect(reconnectPresentation(reconnect.snapshot(), clock.now())?.text).toContain("bad token");
    const captured = reconnect.snapshot();
    captured.phase = "online";
    expect(reconnect.snapshot().phase).toBe("blocked");
    expect(snapshots.length).toBeGreaterThan(3);
    reconnect.stop();
    expect(reconnectPresentation(reconnect.snapshot(), clock.now())).toBeNull();
  });
});
