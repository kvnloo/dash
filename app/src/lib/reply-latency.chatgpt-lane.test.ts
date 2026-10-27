import { describe, expect, test } from "bun:test";
import {
  createLatencyMeter,
  formatLatency,
  LATENCY_ABANDON_MS,
  type LatencyMeter,
} from "./reply-latency";

function finish(
  meter: LatencyMeter,
  id: string,
  sentAtMs: number,
  doneAtMs: number,
  harness?: string,
): void {
  meter.mark(id, "sent", sentAtMs, harness);
  meter.mark(id, "done", doneAtMs);
}

describe("reply latency meter", () => {
  test("starts empty; missing samples have null percentiles", () => {
    const meter = createLatencyMeter();
    expect(meter.turn("missing")).toBeNull();
    expect(meter.summary()).toEqual({
      count: 0,
      abandoned: 0,
      ackMs: { count: 0, p50: null, p90: null, p99: null, max: null },
      startMs: { count: 0, p50: null, p90: null, p99: null, max: null },
      firstDeltaMs: { count: 0, p50: null, p90: null, p99: null, max: null },
      totalMs: { count: 0, p50: null, p90: null, p99: null, max: null },
    });
  });

  // Expected ranks are explicit, including p99=99 (not 100) for 100 samples.
  const cases = [
    { size: 1, p50: 1, p90: 1, p99: 1 },
    { size: 2, p50: 1, p90: 2, p99: 2 },
    { size: 10, p50: 5, p90: 9, p99: 10 },
    { size: 100, p50: 50, p90: 90, p99: 99 },
  ];

  for (const { size, p50, p90, p99 } of cases) {
    test(`nearest-rank p50/p90/p99/max for ${size} completed turns`, () => {
      const meter = createLatencyMeter();
      for (let i = 1; i <= size; i++) {
        const id = `turn-${i}`;
        meter.mark(id, "sent", 10_000, "hermes");
        meter.mark(id, "acked", 10_000 + i);
        meter.mark(id, "started", 10_000 + i * 2);
        meter.mark(id, "first-delta", 10_000 + i * 3);
        meter.mark(id, "done", 10_000 + i * 4);
      }
      const summary = meter.summary("hermes");
      expect(summary.count).toBe(size);
      expect(summary.abandoned).toBe(0);
      expect(summary.ackMs).toEqual({ count: size, p50, p90, p99, max: size });
      expect(summary.startMs).toEqual({
        count: size, p50: p50 * 2, p90: p90 * 2, p99: p99 * 2, max: size * 2,
      });
      expect(summary.firstDeltaMs).toEqual({
        count: size, p50: p50 * 3, p90: p90 * 3, p99: p99 * 3, max: size * 3,
      });
      expect(summary.totalMs).toEqual({
        count: size, p50: p50 * 4, p90: p90 * 4, p99: p99 * 4, max: size * 4,
      });
    });
  }

  test("out-of-order stages are accepted; duplicate stages and pre-sent marks do not overwrite", () => {
    const meter = createLatencyMeter();
    meter.mark("t", "acked", 125); // no sent yet
    meter.mark("t", "first-delta", 130); // no sent yet
    meter.mark("t", "sent", 100, "hermes");
    meter.mark("t", "first-delta", 140);
    meter.mark("t", "acked", 115);
    meter.mark("t", "started", 110);
    meter.mark("t", "acked", 105); // first accepted mark wins, not earliest timestamp
    meter.mark("t", "started", 170);
    meter.mark("t", "first-delta", 120);
    meter.mark("t", "sent", 190, "other"); // retry does not reset sent/harness
    meter.mark("t", "done", 200);
    meter.mark("t", "done", 220);
    meter.mark("t", "failed", 190); // terminal state already established

    expect(meter.turn("t")).toEqual({
      turnId: "t",
      harness: "hermes",
      status: "done",
      sentAtMs: 100,
      ackedAtMs: 115,
      startedAtMs: 110,
      firstDeltaAtMs: 140,
      doneAtMs: 200,
      failedAtMs: null,
      ackMs: 15,
      startMs: 10,
      firstDeltaMs: 40,
      totalMs: 100,
    });
    expect(meter.summary().totalMs.p50).toBe(100);
    expect(meter.turn("t")).not.toBe(meter.turn("t"));
  });

  test("late-arriving first delta before done is accepted; marks after done are ignored", () => {
    const meter = createLatencyMeter();
    finish(meter, "t", 100, 200);
    meter.mark("t", "first-delta", 150); // arrived after done, but occurred before done
    meter.mark("t", "acked", 210); // actually after terminal
    expect(meter.turn("t")?.firstDeltaMs).toBe(50);
    expect(meter.turn("t")?.ackedAtMs).toBeNull();
    expect(meter.summary().firstDeltaMs).toEqual({
      count: 1, p50: 50, p90: 50, p99: 50, max: 50,
    });
  });

  test("impossible or invalid timestamps are ignored and never produce negative durations", () => {
    const meter = createLatencyMeter();
    meter.mark("", "sent", 0);
    meter.mark("bad", "sent", -1);
    meter.mark("bad", "sent", Number.NaN);
    meter.mark("bad", "sent", Number.POSITIVE_INFINITY);
    expect(meter.turn("bad")).toBeNull();

    meter.mark("real", "sent", 100);
    meter.mark("real", "acked", 99);
    meter.mark("real", "acked", Number.NaN);
    meter.mark("real", "acked", 120);
    meter.mark("real", "started", 180);
    meter.mark("real", "done", 150); // started after done is not a usable start metric
    expect(meter.turn("real")?.ackMs).toBe(20);
    expect(meter.turn("real")?.startMs).toBeNull();
    expect(meter.summary().startMs.count).toBe(0);
    expect(meter.summary().totalMs.p50).toBe(50);
  });

  test("completed samples include done only; missing milestones do not become zeros", () => {
    const meter = createLatencyMeter();
    finish(meter, "done", 10, 70);
    meter.mark("failed", "sent", 10);
    meter.mark("failed", "failed", 40);
    meter.mark("failed", "done", 45); // first terminal outcome is immutable
    meter.mark("active", "sent", 10);
    const result = meter.summary();
    expect(result.count).toBe(1);
    expect(result.totalMs).toEqual({ count: 1, p50: 60, p90: 60, p99: 60, max: 60 });
    expect(result.ackMs.count).toBe(0);
    expect(result.startMs.count).toBe(0);
    expect(result.firstDeltaMs.count).toBe(0);
    expect(meter.turn("failed")?.status).toBe("failed");
    expect(meter.turn("failed")?.failedAtMs).toBe(40);
    expect(meter.turn("failed")?.doneAtMs).toBeNull();
    expect(meter.turn("active")?.status).toBe("active");
  });

  test("capacity evicts oldest turn, including completed history, without false abandonment", () => {
    const meter = createLatencyMeter({ capacity: 2 });
    finish(meter, "a", 0, 10);
    meter.mark("b", "sent", 15);
    meter.mark("c", "sent", 20);
    expect(meter.turn("a")).toBeNull();
    expect(meter.turn("b")?.status).toBe("active");
    expect(meter.turn("c")?.status).toBe("active");
    expect(meter.summary().count).toBe(0);

    meter.mark("b", "done", 30);
    expect(meter.summary().totalMs.p50).toBe(15);
    meter.mark("d", "sent", 40);
    expect(meter.turn("b")).toBeNull();
    expect(meter.summary().count).toBe(0);
    expect(meter.summary().abandoned).toBe(0);
  });

  test("ten-minute TTL expires only unfinished turns once, with no timers", () => {
    const meter = createLatencyMeter();
    meter.mark("old-h", "sent", 0, "hermes");
    meter.mark("old-o", "sent", 0, "omp");
    finish(meter, "done", 0, 100, "hermes");

    expect(meter.summary(undefined, LATENCY_ABANDON_MS - 1).abandoned).toBe(0);
    expect(meter.turn("old-h")?.status).toBe("active");
    const after = meter.summary(undefined, LATENCY_ABANDON_MS);
    expect(after.abandoned).toBe(2);
    expect(after.count).toBe(1);
    expect(meter.turn("old-h")).toBeNull();
    expect(meter.turn("old-o")).toBeNull();
    expect(meter.turn("done")?.status).toBe("done");
    expect(meter.summary("hermes").abandoned).toBe(1);
    expect(meter.summary("omp").abandoned).toBe(1);
    meter.mark("old-h", "done", LATENCY_ABANDON_MS + 1); // abandoned cannot be resurrected
    expect(meter.summary(undefined, LATENCY_ABANDON_MS * 2).abandoned).toBe(2);
  });


  test("duplicate sent at the exact TTL boundary expires once instead of resetting first sent", () => {
    const meter = createLatencyMeter();
    const firstSent = 1_000;
    meter.mark("retry", "sent", firstSent, "hermes");
    meter.mark("retry", "acked", firstSent + 20);
    meter.mark("retry", "sent", firstSent + LATENCY_ABANDON_MS - 1, "omp");

    // A retry just before expiry cannot replace the original timestamp or harness.
    expect(meter.turn("retry")?.sentAtMs).toBe(firstSent);
    expect(meter.turn("retry")?.harness).toBe("hermes");
    expect(meter.turn("retry")?.ackMs).toBe(20);
    expect(meter.summary().abandoned).toBe(0);

    // The same retry at the boundary must count abandonment, not start a new turn.
    meter.mark("retry", "sent", firstSent + LATENCY_ABANDON_MS, "omp");
    expect(meter.turn("retry")).toBeNull();
    expect(meter.summary().count).toBe(0);
    expect(meter.summary().abandoned).toBe(1);
    expect(meter.summary("hermes").abandoned).toBe(1);
    expect(meter.summary("omp").abandoned).toBe(0);
  });

  test("retired turn cannot be reopened by sent after a separate TTL sweep", () => {
    const meter = createLatencyMeter();
    meter.mark("expired", "sent", 0, "hermes");
    expect(meter.summary(undefined, LATENCY_ABANDON_MS).abandoned).toBe(1);
    meter.mark("expired", "sent", LATENCY_ABANDON_MS + 1, "omp");
    meter.mark("expired", "done", LATENCY_ABANDON_MS + 2);
    expect(meter.turn("expired")).toBeNull();
    expect(meter.summary().abandoned).toBe(1);
    expect(meter.summary().count).toBe(0);
    expect(meter.summary("omp").abandoned).toBe(0);

    // A new identity is still admitted after a previous one expires.
    finish(meter, "new", LATENCY_ABANDON_MS + 3, LATENCY_ABANDON_MS + 5, "omp");
    expect(meter.summary("omp").count).toBe(1);
    expect(meter.summary("omp").totalMs.p50).toBe(2);
  });

  test("bounded ring eviction also rejects retransmission of a recently evicted identity", () => {
    const meter = createLatencyMeter({ capacity: 2 });
    finish(meter, "first", 0, 10, "hermes");
    meter.mark("second", "sent", 20, "omp");
    meter.mark("third", "sent", 30, "omp");
    expect(meter.turn("first")).toBeNull();

    meter.mark("first", "sent", 40, "hermes"); // same id after eviction
    expect(meter.turn("first")).toBeNull();
    expect(meter.turn("second")?.sentAtMs).toBe(20);
    expect(meter.turn("third")?.sentAtMs).toBe(30);
    expect(meter.summary().abandoned).toBe(0);
    expect(meter.summary().count).toBe(0);
  });

  test("later valid marks drive expiration, but orphan marks do not", () => {
    const meter = createLatencyMeter();
    meter.mark("old", "sent", 0);
    meter.mark("unknown", "done", LATENCY_ABANDON_MS * 2);
    expect(meter.turn("old")?.status).toBe("active");
    meter.mark("new", "sent", LATENCY_ABANDON_MS);
    expect(meter.turn("old")).toBeNull();
    expect(meter.summary().abandoned).toBe(1);
    expect(meter.turn("new")?.status).toBe("active");
  });

  test("harness filters both retained percentile samples and abandoned counters", () => {
    const meter = createLatencyMeter();
    meter.mark("h1", "sent", 0, "hermes");
    meter.mark("h1", "acked", 10);
    meter.mark("h1", "done", 50);
    meter.mark("h2", "sent", 0, "hermes");
    meter.mark("o1", "sent", 0, "omp");
    meter.mark("o1", "acked", 30);
    meter.mark("o1", "done", 90);
    meter.mark("unlabeled", "sent", 0);
    meter.mark("unlabeled", "done", 75);
    const all = meter.summary(undefined, LATENCY_ABANDON_MS);
    expect(all.count).toBe(3);
    expect(all.abandoned).toBe(1);
    expect(all.totalMs.max).toBe(90);
    expect(meter.summary("hermes").count).toBe(1);
    expect(meter.summary("hermes").abandoned).toBe(1);
    expect(meter.summary("hermes").ackMs.p50).toBe(10);
    expect(meter.summary("omp").count).toBe(1);
    expect(meter.summary("omp").totalMs.p50).toBe(90);
    expect(meter.summary("omp").abandoned).toBe(0);
    expect(meter.summary("missing").count).toBe(0);
  });

  test("invalid capacity cannot silently disable the ring bound", () => {
    for (const capacity of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createLatencyMeter({ capacity })).toThrow(RangeError);
    }
    const meter = createLatencyMeter({ capacity: 1 });
    finish(meter, "a", 0, 5);
    finish(meter, "b", 1, 6);
    expect(meter.turn("a")).toBeNull();
    expect(meter.summary().count).toBe(1);
  });
});

describe("formatLatency", () => {
  test("compact millisecond and second formatting", () => {
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(850)).toBe("850 ms");
    expect(formatLatency(999)).toBe("999 ms");
    expect(formatLatency(1_000)).toBe("1.0 s");
    expect(formatLatency(2_400)).toBe("2.4 s");
    expect(formatLatency(10_490)).toBe("10.5 s");
  });

  test("nonfinite or negative elapsed times are not displayed", () => {
    expect(formatLatency(-1)).toBe("—");
    expect(formatLatency(Number.NaN)).toBe("—");
    expect(formatLatency(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
