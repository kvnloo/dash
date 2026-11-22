import { describe, expect, test } from "bun:test";
import type { Z0Lane } from "../../../shared/z0live-lanes";
import { formatElapsed, laneElapsed, laneNow, laneSummary } from "./lane-timeline";

const T = 1_800_000_000;
const fast: Z0Lane = { id: "fast", name: "Fast", model: "gpt-5-mini", status: "working", step: "Reading the diff", since: T };
const large: Z0Lane = { id: "large", name: "Large", status: "working", step: "Planning", since: T + 30 };
const small: Z0Lane = { id: "small", name: "Small", status: "idle", since: T + 10, handoff: { summary: "Looks fine", result: "Looks fine.", at: T + 10 } };
const council: Z0Lane = { id: "council", name: "Council", status: "error", step: "Rate limited", since: T + 5 };

describe("lane timeline text", () => {
  test("elapsed reads as seconds, minutes and hours and never goes negative", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45.9)).toBe("45s");
    expect(formatElapsed(125)).toBe("2m 05s");
    expect(formatElapsed(3725)).toBe("1h 02m");
    expect(formatElapsed(-4)).toBe("0s");
    expect(formatElapsed(Number.NaN)).toBe("0s");
  });

  test("each row says what the lane is doing and for how long", () => {
    expect(laneNow(fast)).toBe("Reading the diff");
    expect(laneElapsed(fast, T + 65)).toBe("1m 05s");
    expect(laneNow(small)).toBe("Idle · handed back");
    expect(laneElapsed(small, T + 22)).toBe("12s ago");
    expect(laneNow(council)).toBe("Failed · Rate limited");
    expect(laneNow({ id: "x", name: "X", status: "idle", since: T })).toBe("Idle · attached");
  });

  test("the collapsed line counts lanes and names the most recent change", () => {
    expect(laneSummary([])).toBe("No lanes attached");
    expect(laneSummary([fast, large, small])).toBe("3 lanes · 2 working · Large: Planning");
    expect(laneSummary([small])).toBe("1 lane · all idle · Small handed back");
    expect(laneSummary([fast, council])).toBe("2 lanes · 1 working · 1 failed · Council failed");
  });
});
