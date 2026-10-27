import { describe, expect, test } from "bun:test";
import {
  FIGURES,
  FIGURE_FRAME,
  createFigureCache,
  matchFigure,
  withinLoadBudget,
} from "./anatomy-catalog";

describe("static anatomy figure catalogue and matcher", () => {
  test("publishes exactly the two prebuilt figures and their canonical keywords", () => {
    expect(FIGURES).toEqual([
      {
        id: "dial-indicator",
        title: "Dial indicator",
        keywords: ["dial indicator", "dial gauge", "indicator", "runout"],
      },
      {
        id: "test-rig",
        title: "Test rig",
        keywords: ["test rig", "test bench", "fixture", "rig"],
      },
    ]);
    expect(FIGURE_FRAME).toEqual({ staticOnly: true });
    expect(Object.isFrozen(FIGURE_FRAME)).toBe(true);
  });

  test("matches explanation questions, ignoring capitalization and punctuation", () => {
    expect(matchFigure("how does a dial indicator work")).toBe("dial-indicator");
    expect(matchFigure("HOW DO you measure RUNOUT?")).toBe("dial-indicator");
    expect(matchFigure("Explain the dial-gauge!")).toBe("dial-indicator");
    expect(matchFigure("What is a test bench?")).toBe("test-rig");
    expect(matchFigure("show me a TEST RIG")).toBe("test-rig");
    expect(matchFigure("explain the fixture")).toBe("test-rig");
  });

  test("does not match shopping questions, partial words, or unrelated explanations", () => {
    expect(matchFigure("dial indicator price")).toBeNull();
    expect(matchFigure("where can I buy a test rig?")).toBeNull();
    expect(matchFigure("explain indicators and fixtures")).toBeNull();
    expect(matchFigure("show me a running car")).toBeNull();
    expect(matchFigure("how does the gearbox work")).toBeNull();
    expect(matchFigure("")).toBeNull();
  });

  test("scores keywords rather than substring occurrences and refuses tied winners", () => {
    expect(matchFigure("explain a dial indicator next to a test rig")).toBeNull();
    expect(matchFigure("show me a dial indicator with a test bench")).toBe("dial-indicator");
    expect(matchFigure("what is a dial indicator indicator indicator?")).toBe("dial-indicator");
  });
});

describe("injected anatomy HTML cache", () => {
  test("coalesces concurrent gets into one loader call and measures from the injected clock", async () => {
    let clock = 100;
    let loads = 0;
    let complete: ((html: string) => void) | undefined;
    const cache = createFigureCache({
      now: () => clock,
      load: () => {
        loads++;
        return new Promise<string>(resolve => { complete = resolve; });
      },
    });

    const first = cache.get("dial-indicator");
    const second = cache.get("dial-indicator");
    expect(first).toBe(second);
    await Promise.resolve();
    expect(loads).toBe(1);
    if (!complete) throw new Error("Injected loader did not start");

    clock += 42;
    complete("<figure>Dial</figure>");
    expect(await first).toEqual({
      html: "<figure>Dial</figure>",
      fromCache: false,
      loadMs: 42,
    });
    expect(await second).toEqual({
      html: "<figure>Dial</figure>",
      fromCache: false,
      loadMs: 42,
    });

    clock += 500;
    expect(await cache.get("dial-indicator")).toEqual({
      html: "<figure>Dial</figure>",
      fromCache: true,
      loadMs: 0,
    });
    expect(loads).toBe(1);
  });

  test("evicts at capacity one and reloading an evicted ID calls the loader again", async () => {
    const requested: string[] = [];
    const cache = createFigureCache({
      capacity: 1,
      now: () => 100,
      load: async id => {
        requested.push(id);
        return "<html>" + id + "</html>";
      },
    });

    expect((await cache.get("dial-indicator")).fromCache).toBe(false);
    expect((await cache.get("dial-indicator")).fromCache).toBe(true);
    expect((await cache.get("test-rig")).fromCache).toBe(false);
    expect((await cache.get("test-rig")).fromCache).toBe(true);
    expect((await cache.get("dial-indicator")).fromCache).toBe(false);
    expect(requested).toEqual(["dial-indicator", "test-rig", "dial-indicator"]);
  });

  test("at capacity two, repeated accesses retain both known catalogue IDs", async () => {
    // The catalogue has only two allowed IDs; a third distinct ID must reject.
    // Actual eviction is exercised above with capacity one.
    let loads = 0;
    const cache = createFigureCache({
      capacity: 2,
      now: () => 1,
      load: async id => {
        loads++;
        return id;
      },
    });

    await cache.get("dial-indicator");
    await cache.get("test-rig");
    expect((await cache.get("dial-indicator")).fromCache).toBe(true);
    expect((await cache.get("test-rig")).fromCache).toBe(true);
    expect(loads).toBe(2);
    await expect(cache.get("third-figure")).rejects.toThrow("Unknown anatomy figure");
    expect(loads).toBe(2);
  });

  test("rejects unknown IDs without touching the loader", async () => {
    let calls = 0;
    const cache = createFigureCache({
      now: () => 0,
      load: async () => { calls++; return "<html />"; },
    });
    await expect(cache.get("unknown-id")).rejects.toThrow("Unknown anatomy figure: unknown-id");
    await expect(cache.get("dial-indicator-x")).rejects.toThrow("Unknown anatomy figure");
    expect(calls).toBe(0);
  });

  test("does not cache a rejected load, and a later retry may succeed", async () => {
    let calls = 0;
    const cache = createFigureCache({
      now: () => 10,
      load: async () => {
        calls++;
        if (calls === 1) throw new Error("figure unavailable");
        return "<html>recovered</html>";
      },
    });

    await expect(cache.get("test-rig")).rejects.toThrow("figure unavailable");
    expect(await cache.get("test-rig")).toEqual({
      html: "<html>recovered</html>",
      fromCache: false,
      loadMs: 0,
    });
    expect((await cache.get("test-rig")).fromCache).toBe(true);
    expect(calls).toBe(2);
  });

  test("shares a rejection with all callers but retries after it settles", async () => {
    let calls = 0;
    const cache = createFigureCache({
      now: () => 0,
      load: async () => {
        calls++;
        if (calls === 1) throw new Error("offline");
        return "";
      },
    });

    const first = cache.get("dial-indicator");
    const second = cache.get("dial-indicator");
    expect(first).toBe(second);
    await expect(first).rejects.toThrow("offline");
    await expect(second).rejects.toThrow("offline");
    expect((await cache.get("dial-indicator")).fromCache).toBe(false);
    expect((await cache.get("dial-indicator")).fromCache).toBe(true);
    expect(calls).toBe(2);
  });

  test("rejects invalid cache capacities immediately without invoking a loader", () => {
    for (const capacity of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => createFigureCache({
        capacity,
        now: () => 0,
        load: async () => "<html />",
      })).toThrow(RangeError);
    }
  });

  test("clamps negative elapsed durations when the injected clock regresses", async () => {
    let clock = 10;
    const cache = createFigureCache({
      now: () => clock,
      load: async () => {
        clock = 5;
        return "";
      },
    });
    expect(await cache.get("test-rig")).toEqual({ html: "", fromCache: false, loadMs: 0 });
    expect((await cache.get("test-rig")).fromCache).toBe(true);
  });
});

describe("static figure load budget", () => {
  test("accepts inclusive 300ms default budget and configurable limits", () => {
    expect(withinLoadBudget(0)).toBe(true);
    expect(withinLoadBudget(300)).toBe(true);
    expect(withinLoadBudget(301)).toBe(false);
    expect(withinLoadBudget(450, 500)).toBe(true);
    expect(withinLoadBudget(501, 500)).toBe(false);
  });

  test("rejects negative, nonfinite or invalid measurements", () => {
    for (const elapsed of [-1, Number.NaN, Infinity, -Infinity]) {
      expect(withinLoadBudget(elapsed)).toBe(false);
    }
    for (const budget of [-1, Number.NaN, Infinity, -Infinity]) {
      expect(withinLoadBudget(50, budget)).toBe(false);
    }
  });
});
