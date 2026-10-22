import { describe, expect, test } from "bun:test";
import {
  CLOSE_HIT,
  MODEL_UNKNOWN,
  MORPH_SCALE_FROM,
  PILL_GAP,
  PILL_HEIGHT,
  PILL_HIT,
  backTarget,
  identityBadge,
  identityLabel,
  morphFrom,
  pillGeometry,
  pillReserve,
  pillStatus,
  shortSession,
  surfaceValue,
} from "./chat-window";

describe("pillGeometry", () => {
  test("unknown cut-out falls back to a centred safe-area pill below the status inset", () => {
    const g = pillGeometry({ insetTop: 36, width: 412 });
    expect(g.mode).toBe("safe-area");
    expect(g.top).toBe(36 + PILL_GAP);
    expect(g.height).toBe(PILL_HEIGHT);
    expect(g.width).toBeCloseTo(412 * 0.56);
    expect(g.left).toBeCloseTo((412 - g.width) / 2);
    expect(g.hole).toBeNull();
    expect(pillReserve(g)).toBe(36 + PILL_GAP + PILL_HEIGHT + PILL_GAP);
  });

  test("wide windows cap the pill at 260", () => {
    const g = pillGeometry({ insetTop: 24, width: 900, cutout: null });
    expect(g.width).toBe(260);
    expect(g.left).toBe(320);
  });

  test("a top cut-out is wrapped, centred on the hole, and never covered", () => {
    const cutout = { x: 192, y: 10, width: 28, height: 28 };
    const g = pillGeometry({ insetTop: 40, width: 412, cutout });
    expect(g.mode).toBe("cutout");
    expect(g.left + g.width / 2).toBeCloseTo(206);
    expect(g.top).toBeLessThanOrEqual(cutout.y);
    expect(g.top + g.height).toBeGreaterThanOrEqual(cutout.y + cutout.height);
    expect(g.height).toBe(28 + 2 * PILL_GAP);
    expect(g.hole).toEqual({ left: cutout.x - g.left - PILL_GAP, width: 28 + 2 * PILL_GAP });
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(g.left + g.width).toBeLessThanOrEqual(412);
  });

  test("an off-centre cut-out keeps the pill inside the window", () => {
    const g = pillGeometry({ insetTop: 40, width: 360, cutout: { x: 8, y: 8, width: 24, height: 24 } });
    expect(g.mode).toBe("cutout");
    expect(g.left).toBe(0);
    expect(g.hole?.left).toBe(8 - PILL_GAP);
  });

  test("small cut-outs still give the minimum pill height", () => {
    const g = pillGeometry({ insetTop: 30, width: 400, cutout: { x: 190, y: 6, width: 10, height: 10 } });
    expect(g.height).toBe(PILL_HEIGHT);
  });

  test("rects outside the top band or window are ignored (rotation, side cut-outs)", () => {
    expect(pillGeometry({ insetTop: 0, width: 800, cutout: { x: 0, y: 300, width: 30, height: 30 } }).mode).toBe("safe-area");
    expect(pillGeometry({ insetTop: 30, width: 400, cutout: { x: 390, y: 5, width: 30, height: 30 } }).mode).toBe("safe-area");
    expect(pillGeometry({ insetTop: 30, width: 400, cutout: { x: 100, y: 5, width: 0, height: 30 } }).mode).toBe("safe-area");
    expect(pillGeometry({ insetTop: 30, width: 400, cutout: { x: -1, y: 5, width: 20, height: 30 } }).mode).toBe("safe-area");
    expect(pillGeometry({ insetTop: 30, width: 400, cutout: { x: 100, y: -1, width: 20, height: 30 } }).mode).toBe("safe-area");
    expect(pillGeometry({ insetTop: 30, width: 400, cutout: { x: 100, y: 5, width: 20, height: 0 } }).mode).toBe("safe-area");
  });

  test("touch targets stay at least 44", () => {
    expect(PILL_HIT).toBeGreaterThanOrEqual(44);
    expect(CLOSE_HIT).toBeGreaterThanOrEqual(44);
  });
});

describe("morphFrom", () => {
  test("starts at the source row centre", () => {
    expect(morphFrom({ y: 300, height: 68 }, 900)).toEqual({ translateY: 334 - 450, scale: MORPH_SCALE_FROM });
  });
  test("clamps far rows and handles a missing origin", () => {
    expect(morphFrom({ y: 5000, height: 68 }, 900).translateY).toBe(450);
    expect(morphFrom({ y: -5000, height: 68 }, 900).translateY).toBe(-450);
    expect(morphFrom(undefined, 900)).toEqual({ translateY: 0, scale: MORPH_SCALE_FROM });
    expect(morphFrom({ y: 10, height: 10 }, 0)).toEqual({ translateY: 0, scale: MORPH_SCALE_FROM });
  });
});

describe("backTarget", () => {
  test("menu, then tree, then nav, then the window", () => {
    expect(backTarget({ menuOpen: true, treeOpen: true, navOpen: true })).toBe("menu");
    expect(backTarget({ menuOpen: false, treeOpen: true, navOpen: true })).toBe("tree");
    expect(backTarget({ menuOpen: false, treeOpen: false, navOpen: true })).toBe("nav");
    expect(backTarget({ menuOpen: false, treeOpen: false, navOpen: false })).toBe("window");
  });
});

describe("identityBadge", () => {
  const full = { hostName: "groot", harnessName: "hermes", profile: "clean", sessionId: "20261022_abcdef", model: undefined };
  test("full text when it fits, model unknown when the host has not reported one", () => {
    expect(identityBadge(full, 80)).toBe("groot · hermes · clean · 20261022 · model unknown");
  });
  test("drops host first, then harness, then truncates profile", () => {
    expect(identityBadge(full, 44)).toBe("hermes · clean · 20261022 · model unknown");
    expect(identityBadge(full, 35)).toBe("clean · 20261022 · model unknown");
    expect(identityBadge({ ...full, profile: "chiefstaff" }, 35)).toBe("chiefs… · 20261022 · model unknown");
  });
  test("model middle-truncates last and keeps head and tail", () => {
    const text = identityBadge({ ...full, profile: "chiefstaff", model: "claude-opus-5-5-20261001" }, 30);
    expect(text).toBe("chiefs… · 20261022 · claud…1001");
  });
  test("profile equal to harness is not repeated; unattached chats say so", () => {
    expect(identityBadge({ harnessName: "omp" }, 80)).toBe("omp · new chat · model unknown");
  });
  test("a reported model is shown verbatim", () => {
    expect(identityBadge({ ...full, model: "m1" }, 80)).toBe("groot · hermes · clean · 20261022 · m1");
  });
  test("a11y label carries every field", () => {
    const label = identityLabel(full);
    expect(label).toContain("host groot");
    expect(label).toContain("harness hermes");
    expect(label).toContain("profile clean");
    expect(label).toContain("session 20261022_abcdef");
    expect(label).toContain("model unknown, host has not reported it");
    expect(identityLabel({ harnessName: "omp", model: "x" })).toContain("host unknown, harness omp, profile none, session not attached yet, model x");
  });
  test("short session and constants", () => {
    expect(shortSession("abcdefghij")).toBe("abcdefgh");
    expect(shortSession(undefined)).toBeUndefined();
    expect(MODEL_UNKNOWN).toBe("model unknown");
  });
});

describe("pillStatus", () => {
  test("idle and online says nothing invented", () => {
    expect(pillStatus({ online: true, phase: "idle", queued: 0 })).toEqual([]);
  });
  test("reports offline, tool, working, voice and queue", () => {
    expect(pillStatus({ online: false, phase: "thinking", queued: 0 })).toEqual(["offline"]);
    expect(pillStatus({ online: true, phase: "tool", tool: "terminal", queued: 2 })).toEqual(["running terminal", "2 queued"]);
    expect(pillStatus({ online: true, phase: "tool", queued: 0 })).toEqual(["running tool"]);
    expect(pillStatus({ online: true, phase: "writing", voicePhase: "listening", queued: 0 })).toEqual(["working", "voice listening"]);
  });
});

test("surface value names the current surface and the switch", () => {
  expect(surfaceValue(false)).toBe("Current: Chat · switch to Live surface");
  expect(surfaceValue(true)).toBe("Current: Live surface · switch to Chat");
});
