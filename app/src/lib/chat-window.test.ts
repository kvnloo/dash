import { describe, expect, test } from "bun:test";
import {
  CLOSE_GLYPH,
  CLOSE_HIT,
  MODEL_UNKNOWN,
  MORPH_SCALE_FROM,
  PILL_GAP,
  PILL_HEIGHT,
  PILL_HIT,
  PILL_LABEL_SLOT,
  STATUS_CHARS,
  backTarget,
  hostIdentity,
  parseCutout,
  pillPrimary,
  topCutout,
  identityLabel,
  identityLines,
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

  test("geometry constants are pinned (visual 28/24 pt, 44 pt hits, 4 pt gap, 0.94 morph)", () => {
    expect([PILL_HEIGHT, PILL_GAP, PILL_HIT, CLOSE_HIT, CLOSE_GLYPH, PILL_LABEL_SLOT, MORPH_SCALE_FROM]).toEqual([28, 4, 44, 44, 24, 112, 0.94]);
  });

  test("a wide cut-out gets a label slot on each side even past the normal cap", () => {
    const g = pillGeometry({ insetTop: 40, width: 900, cutout: { x: 350, y: 10, width: 200, height: 28 } });
    expect(g.width).toBe(200 + 2 * 112);
    expect(g.left).toBe(450 - 212);
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

describe("identityLines", () => {
  const full = { hostName: "groot", harnessName: "hermes", profile: "clean", sessionId: "20261022_abcdef", model: undefined };
  test("full text when it fits, model unknown on its own line when the host has not reported one", () => {
    expect(identityLines(full, 40)).toEqual({ who: "groot · hermes · clean · 20261022", model: "model unknown" });
    expect(identityLines(full, 33).who).toBe("groot · hermes · clean · 20261022");
  });
  test("drops host first, then harness, then truncates profile; session stays", () => {
    expect(identityLines(full, 32).who).toBe("hermes · clean · 20261022");
    expect(identityLines(full, 25).who).toBe("hermes · clean · 20261022");
    expect(identityLines(full, 24).who).toBe("clean · 20261022");
    expect(identityLines(full, 16).who).toBe("clean · 20261022");
    expect(identityLines({ ...full, profile: "chiefstaff" }, 21).who).toBe("chiefstaff · 20261022");
    expect(identityLines({ ...full, profile: "chiefstaff" }, 20).who).toBe("chiefs… · 20261022");
    expect(identityLines({ ...full, profile: "chiefs7" }, 10).who).toBe("chiefs7 · 20261022");
  });
  test("model middle-truncates only past its own budget, keeping head and tail", () => {
    expect(identityLines(full, 13).model).toBe("model unknown");
    expect(identityLines({ ...full, model: "claude-opus-5-5-20261001" }, 24).model).toBe("claude-opus-5-5-20261001");
    expect(identityLines({ ...full, model: "claude-opus-5-5-20261001" }, 12).model).toBe("claude…61001");
    expect(identityLines({ ...full, model: "claude-opus-5-5-20261001" }, 3).model).toBe("cla…001");
  });
  test("profile equal to harness is not repeated; unattached chats say so", () => {
    expect(identityLines({ harnessName: "omp" }, 80)).toEqual({ who: "omp · new chat", model: "model unknown" });
  });
  test("a reported model is shown verbatim", () => {
    expect(identityLines({ ...full, model: "m1" }, 80).model).toBe("m1");
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

describe("native cut-out reading", () => {
  const reading = { supported: true, rects: [{ x: 192, y: 8, width: 27.43, height: 27.43 }], windowWidth: 411.43, windowHeight: 891.43, safeInsetTop: 35.43, rotation: 0, density: 3.5, statusBarTop: 40 };
  test("parses the module map and rejects malformed or unsupported values", () => {
    expect(parseCutout(reading)).toEqual({ supported: true, rects: [{ x: 192, y: 8, width: 27.43, height: 27.43 }], windowWidth: 411.43, windowHeight: 891.43, safeInsetTop: 35.43, rotation: 0 });
    for (const bad of [null, 3, [], { ...reading, supported: false }, { ...reading, rects: "x" }, { ...reading, windowWidth: "411" }, { ...reading, windowHeight: Infinity }, { ...reading, safeInsetTop: undefined }, { ...reading, rotation: null }, { ...reading, rects: [{ x: 1, y: 2, width: 3 }] }, { ...reading, rects: [null] }]) expect(parseCutout(bad)).toBeNull();
  });
  test("picks the top-band hole for the matching window, ignores stale/rotated readings", () => {
    const parsed = parseCutout(reading);
    expect(topCutout(parsed, { width: 411.43, insetTop: 40 })).toEqual({ x: 192, y: 8, width: 27.43, height: 27.43 });
    expect(topCutout(parsed, { width: 413.4, insetTop: 40 })).toEqual({ x: 192, y: 8, width: 27.43, height: 27.43 });
    expect(topCutout(parsed, { width: 891.43, insetTop: 0 })).toBeNull();
    expect(topCutout(parsed, { width: 409.4, insetTop: 40 })).toBeNull();
    expect(topCutout(null, { width: 411.43, insetTop: 40 })).toBeNull();
    const two = { ...reading, rects: [{ x: 0, y: 500, width: 20, height: 40 }, { x: 100, y: 20, width: 20, height: 20 }, { x: 192, y: 6, width: 28, height: 28 }] };
    expect(topCutout(parseCutout(two), { width: 411.43, insetTop: 40 })).toEqual({ x: 192, y: 6, width: 28, height: 28 });
    const tall = { ...reading, rects: [{ x: 0, y: 0, width: 411, height: 200 }] };
    expect(topCutout(parseCutout(tall), { width: 411.43, insetTop: 40 })).toBeNull();
    const edge = { ...reading, safeInsetTop: 0, rects: [{ x: 192, y: 67.9, width: 20, height: 20 }] };
    expect(topCutout(parseCutout(edge), { width: 411.43, insetTop: 40 })).toEqual({ x: 192, y: 67.9, width: 20, height: 20 });
    expect(topCutout(parseCutout({ ...edge, rects: [{ x: 192, y: 68, width: 20, height: 20 }] }), { width: 411.43, insetTop: 40 })).toBeNull();
    expect(topCutout(parseCutout({ ...edge, safeInsetTop: 50 }), { width: 411.43, insetTop: 40 })).toEqual({ x: 192, y: 67.9, width: 20, height: 20 });
    expect(topCutout(parseCutout({ ...edge, rects: [{ x: 192, y: 60, width: 20, height: 36 }] }), { width: 411.43, insetTop: 40 })).toEqual({ x: 192, y: 60, width: 20, height: 36 });
    expect(topCutout(parseCutout({ ...edge, rects: [{ x: 192, y: 60, width: 20, height: 37 }] }), { width: 411.43, insetTop: 40 })).toBeNull();
  });
  test("a parsed S25-like reading yields a cut-out pill wrapping the hole inside the status band", () => {
    const hole = topCutout(parseCutout(reading), { width: 411.43, insetTop: 40 });
    const g = pillGeometry({ insetTop: 40, width: 411.43, cutout: hole });
    expect(g.mode).toBe("cutout");
    expect(g.left + (g.hole?.left ?? 0) + PILL_GAP).toBeCloseTo(192);
    expect(g.top + g.height).toBeLessThanOrEqual(40);
    expect(pillReserve(g, 40)).toBeCloseTo(43.43);
    expect(pillReserve(g, 60)).toBe(60);
    expect(pillReserve(g, 0)).toBeCloseTo(g.top + g.height + PILL_GAP);
  });
});

describe("pillPrimary", () => {
  test("one reserved status, highest priority first, never invented", () => {
    expect(pillPrimary({ online: true, phase: "idle", queued: 0 })).toBeNull();
    expect(pillPrimary({ online: false, phase: "tool", voicePhase: "listening", queued: 2 })).toEqual({ glyph: "wifi-off", text: "offline" });
    expect(pillPrimary({ online: true, phase: "tool", tool: "terminal", voicePhase: "listening", queued: 2 })).toEqual({ glyph: "mic", text: "listening" });
    expect(pillPrimary({ online: true, phase: "tool", tool: "terminal", queued: 2 })).toEqual({ glyph: "tool", text: "terminal" });
    expect(pillPrimary({ online: true, phase: "tool", queued: 0 })).toEqual({ glyph: "tool", text: "tool" });
    expect(pillPrimary({ online: true, phase: "thinking", queued: 2 })).toEqual({ glyph: "activity", text: "working" });
    expect(pillPrimary({ online: true, phase: "idle", queued: 3 })).toEqual({ glyph: "layers", text: "3 queued" });
  });
  test("status text is bounded to the reserved slot", () => {
    expect(STATUS_CHARS).toBe(12);
    expect(pillPrimary({ online: true, phase: "tool", tool: "mcp_github_create_pull_request", queued: 0 })).toEqual({ glyph: "tool", text: "mcp_github_…" });
    expect(pillPrimary({ online: true, phase: "tool", tool: "abcdefghijkl", queued: 0 })?.text).toBe("abcdefghijkl");
    expect(pillPrimary({ online: true, phase: "idle", voicePhase: "reconnecting-now", queued: 0 })?.text).toBe("reconnectin…");
    expect(pillPrimary({ online: true, phase: "idle", queued: 1234567890123 })?.text).toBe("12345678901…");
  });
});

describe("hostIdentity", () => {
  test("binds only the attached session or its compaction continuation", () => {
    const reading = { sessionId: "s1", model: "claude-opus-5-5", provider: "anthropic" };
    expect(hostIdentity(reading, "s1", 5)).toEqual({ model: "claude-opus-5-5", provider: "anthropic", observedAt: 5 });
    expect(hostIdentity(reading, "other", 5)).toEqual({});
    expect(hostIdentity(reading, undefined, 5)).toEqual({});
    expect(hostIdentity(undefined, "s1", 5)).toEqual({});
    expect(hostIdentity({ sessionId: "s2", model: "m", parentSessionId: "s1" }, "s1")).toEqual({ model: "m", parentSessionId: "s1", continuedAs: "s2" });
    expect(hostIdentity({ sessionId: "s1", model: "", parentSessionId: "root" }, "s1")).toEqual({ parentSessionId: "root" });
  });
  test("badge shows provider · model only when reported", () => {
    const base = { harnessName: "hermes", profile: "clean", sessionId: "s1" };
    expect(identityLines({ ...base, model: "claude-opus-5-5", provider: "anthropic" }, 40).model).toBe("anthropic · claude-opus-5-5");
    expect(identityLines({ ...base, model: "claude-opus-5-5", provider: "anthropic" }, 27).model).toBe("anthropic · claude-opus-5-5");
    expect(identityLines({ ...base, model: "claude-opus-5-5", provider: "anthropic" }, 26).model).toBe("claude-opus-5-5");
    expect(identityLines({ ...base, model: "claude-opus-5-5", provider: "anthropic" }, 15).model).toBe("claude-opus-5-5");
    expect(identityLines({ ...base, model: "claude-opus-5-5", provider: "anthropic" }, 14).model).toBe("claude-…us-5-5");
    expect(identityLines({ ...base, provider: "anthropic" }, 40).model).toBe("model unknown");
    expect(identityLabel({ ...base, model: "m", provider: "p" })).toContain("model p m, reported by host");
  });
});
