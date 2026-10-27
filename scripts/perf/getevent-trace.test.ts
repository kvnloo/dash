import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  parseGetevent,
  replayPlan,
  toGestures,
  toInputCommand,
  type Gesture,
  type InputEvent,
} from "./getevent-trace";

const scriptFile = fileURLToPath(new URL("./getevent-trace.ts", import.meta.url));
const fixtureFile = fileURLToPath(new URL("./fixtures/getevent-swipe.txt", import.meta.url));
const fixture = readFileSync(fixtureFile, "utf8");
const geometry = { maxX: 1000, maxY: 2000, screenW: 1080, screenH: 2400 };

function event(
  tUs: number,
  type: string,
  code: string,
  value: number,
  device = "/dev/input/event2",
): InputEvent {
  return { tUs, type, code, value, device };
}

function singleGesture(): Gesture {
  const gestures = toGestures(parseGetevent(fixture));
  const gesture = gestures[0];
  if (!gesture) throw new Error("fixture did not yield a gesture");
  return gesture;
}

describe("parseGetevent -lt", () => {
  test("parses synthetic capture and ignores device header lines", () => {
    const events = parseGetevent(fixture);
    expect(events).toHaveLength(15);
    expect(events.warnings).toEqual([]);
    expect(events[3]).toEqual({
      tUs: 12_345_000_030,
      device: "/dev/input/event2",
      type: "EV_ABS",
      code: "ABS_MT_POSITION_X",
      value: 500,
    });
  });

  test("interprets hex as signed 32-bit, including lift -1", () => {
    const events = parseGetevent(fixture);
    const lift = events.find((item) => item.code === "ABS_MT_TRACKING_ID" && item.value < 0);
    expect(lift?.value).toBe(-1);

    const unsignedHex = parseGetevent(
      "[ 0.000001] /dev/input/event0: EV_ABS ABS_MT_TRACKING_ID 80000000",
    );
    expect(unsignedHex[0]?.value).toBe(-2147483648);
  });

  test("preserves microsecond precision from short fractional timestamps", () => {
    const events = parseGetevent(
      "[ 1.2] /dev/input/event1: EV_ABS ABS_MT_POSITION_X 00000010",
    );
    expect(events[0]?.tUs).toBe(1_200_000);
    expect(events[0]?.value).toBe(16);
  });

  test("ignores blank and device-info lines; reports malformed events without throwing", () => {
    const events = parseGetevent([
      "",
      "add device 1: /dev/input/event2",
      "  name: \"synthetic\"",
      "totally unrelated garbage",
      "[ 1.000010] /dev/input/event2: EV_ABS ABS_MT_POSITION_X 0000000a",
      "[ 1.000011] /dev/input/event2: EV_ABS ABS_MT_POSITION_Y not_hex",
      "[ 1.1234567] /dev/input/event2: EV_SYN SYN_REPORT 00000000",
    ].join("\n"));
    expect(events).toHaveLength(1);
    expect(events[0]?.value).toBe(10);
    expect(events.warnings).toHaveLength(3);
    expect(events.warnings[0]).toContain("line 4");
    expect(events.warnings[1]).toContain("invalid timestamp/value");
  });
});

describe("toGestures - frame and slot grouping", () => {
  test("produces one swipe from four SYN_REPORT frames with exact times", () => {
    const gestures = toGestures(parseGetevent(fixture));
    expect(gestures).toHaveLength(1);
    expect(gestures.warnings).toEqual([]);
    expect(gestures[0]).toEqual({
      startUs: 12_345_000_100,
      endUs: 12_345_300_100,
      durationMs: 300,
      points: [
        { tUs: 12_345_000_100, x: 500, y: 1000 },
        { tUs: 12_345_120_100, x: 700, y: 1200 },
        { tUs: 12_345_250_100, x: 1000, y: 1500 },
      ],
    });
  });

  test("ends on -1 tracking ID even without BTN_TOUCH UP", () => {
    const events = parseGetevent(fixture).filter((item) => item.code !== "BTN_TOUCH");
    const gestures = toGestures(events);
    expect(gestures).toHaveLength(1);
    expect(gestures[0]?.endUs).toBe(12_345_300_100);
  });

  test("accepts BTN_TOUCH DOWN/UP without tracking IDs", () => {
    const events = parseGetevent(fixture).filter((item) => item.code !== "ABS_MT_TRACKING_ID");
    const gestures = toGestures(events);
    expect(gestures).toHaveLength(1);
    expect(gestures[0]?.points).toHaveLength(3);
  });

  test("warns on slot 1 and does not leak its positions into slot 0", () => {
    const events: InputEvent[] = [
      event(1, "EV_ABS", "ABS_MT_SLOT", 0),
      event(2, "EV_ABS", "ABS_MT_TRACKING_ID", 4),
      event(3, "EV_ABS", "ABS_MT_POSITION_X", 100),
      event(4, "EV_ABS", "ABS_MT_POSITION_Y", 200),
      event(10, "EV_SYN", "SYN_REPORT", 0),
      event(20, "EV_ABS", "ABS_MT_SLOT", 1),
      event(21, "EV_ABS", "ABS_MT_TRACKING_ID", 5),
      event(22, "EV_ABS", "ABS_MT_POSITION_X", 999),
      event(23, "EV_ABS", "ABS_MT_POSITION_Y", 999),
      event(30, "EV_SYN", "SYN_REPORT", 0),
      event(40, "EV_ABS", "ABS_MT_SLOT", 0),
      event(41, "EV_ABS", "ABS_MT_POSITION_X", 120),
      event(42, "EV_ABS", "ABS_MT_POSITION_Y", 220),
      event(50, "EV_SYN", "SYN_REPORT", 0),
      event(60, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(70, "EV_SYN", "SYN_REPORT", 0),
    ];
    const gestures = toGestures(events);
    expect(gestures).toHaveLength(1);
    expect(gestures.warnings).toEqual([
      "/dev/input/event2 at 30: ignoring multi-touch slot 1",
    ]);
    expect(gestures[0]?.points).toEqual([
      { tUs: 10, x: 100, y: 200 },
      { tUs: 50, x: 120, y: 220 },
    ]);
  });

  test("keeps different device frames independent and honors device filter", () => {
    const other = "/dev/input/event9";
    const events: InputEvent[] = [
      event(0, "EV_KEY", "BTN_TOUCH", 1),
      event(1, "EV_ABS", "ABS_MT_POSITION_X", 100),
      event(2, "EV_ABS", "ABS_MT_POSITION_Y", 200),
      event(3, "EV_SYN", "SYN_REPORT", 0),
      event(4, "EV_KEY", "BTN_TOUCH", 1, other),
      event(5, "EV_ABS", "ABS_MT_POSITION_X", 300, other),
      event(6, "EV_ABS", "ABS_MT_POSITION_Y", 400, other),
      event(7, "EV_SYN", "SYN_REPORT", 0, other),
      event(8, "EV_KEY", "BTN_TOUCH", 0),
      event(9, "EV_SYN", "SYN_REPORT", 0),
      event(10, "EV_KEY", "BTN_TOUCH", 0, other),
      event(11, "EV_SYN", "SYN_REPORT", 0, other),
    ];
    const all = toGestures(events);
    expect(all).toHaveLength(2);
    expect(all[0]?.points[0]?.x).toBe(100);
    expect(all[1]?.points[0]?.x).toBe(300);
    const filtered = toGestures(events, { device: other });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.points[0]?.x).toBe(300);
  });

  test("does not emit unfinished or dropped synchronized contacts", () => {
    const events = parseGetevent(fixture);
    const missingLift = toGestures(events.slice(0, -3));
    expect(missingLift).toHaveLength(0);
    expect(missingLift.warnings.join(" ")).toContain("unfinished gesture");

    const dropped = toGestures([
      event(1, "EV_KEY", "BTN_TOUCH", 1),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 20),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 30),
      event(4, "EV_SYN", "SYN_REPORT", 0),
      event(5, "EV_SYN", "SYN_DROPPED", 0),
      event(6, "EV_KEY", "BTN_TOUCH", 0),
      event(7, "EV_SYN", "SYN_REPORT", 0),
    ]);
    expect(dropped).toHaveLength(0);
    expect(dropped.warnings.join(" ")).toContain("SYN_DROPPED");
  });
  test("discards every event through the first SYN_REPORT after SYN_DROPPED", () => {
    const gestures = toGestures([
      event(1, "EV_ABS", "ABS_MT_TRACKING_ID", 1),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 10),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 20),
      event(4, "EV_SYN", "SYN_REPORT", 0),
      event(5, "EV_ABS", "ABS_MT_POSITION_X", 30),
      event(6, "EV_SYN", "SYN_DROPPED", 0),
      // Even complete contacts in this interval are not synchronized.
      event(7, "EV_ABS", "ABS_MT_TRACKING_ID", 2),
      event(8, "EV_ABS", "ABS_MT_POSITION_X", 40),
      event(9, "EV_ABS", "ABS_MT_POSITION_Y", 50),
      event(10, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(11, "EV_SYN", "SYN_DROPPED", 0),
      event(12, "EV_KEY", "BTN_TOUCH", 1),
      event(13, "EV_ABS", "ABS_MT_POSITION_X", 60),
      event(14, "EV_ABS", "ABS_MT_POSITION_Y", 70),
      event(15, "EV_KEY", "BTN_TOUCH", 0),
      event(16, "EV_SYN", "SYN_REPORT", 0),
    ]);
    expect(gestures).toHaveLength(0);
    expect(gestures.warnings).toEqual([
      "/dev/input/event2 at 6: SYN_DROPPED; discarding unsynchronized gesture",
      "/dev/input/event2 at 11: SYN_DROPPED; discarding unsynchronized gesture",
    ]);
  });

  test("does not retain discarded coordinates or slot selection after recovery", () => {
    const gestures = toGestures([
      event(1, "EV_SYN", "SYN_DROPPED", 0),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 90),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 100),
      event(4, "EV_ABS", "ABS_MT_SLOT", 1),
      event(5, "EV_SYN", "SYN_REPORT", 0),
      event(6, "EV_ABS", "ABS_MT_TRACKING_ID", 2),
      event(7, "EV_SYN", "SYN_REPORT", 0),
      event(8, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(9, "EV_SYN", "SYN_REPORT", 0),
      event(10, "EV_ABS", "ABS_MT_TRACKING_ID", 3),
      event(11, "EV_ABS", "ABS_MT_POSITION_X", 20),
      event(12, "EV_ABS", "ABS_MT_POSITION_Y", 30),
      event(13, "EV_SYN", "SYN_REPORT", 0),
      event(14, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(15, "EV_SYN", "SYN_REPORT", 0),
    ]);
    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toEqual({
      startUs: 13, endUs: 15, durationMs: 0.002,
      points: [{ tUs: 13, x: 20, y: 30 }],
    });
    expect(gestures.warnings).toEqual([
      "/dev/input/event2 at 1: SYN_DROPPED; discarding unsynchronized gesture",
      "/dev/input/event2 at 9: contact ended without slot-0 coordinates",
    ]);
  });

  test("drop recovery is per-device and waits for that device's SYN_REPORT", () => {
    const other = "/dev/input/event9";
    const gestures = toGestures([
      event(1, "EV_KEY", "BTN_TOUCH", 1, other),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 30, other),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 40, other),
      event(4, "EV_SYN", "SYN_REPORT", 0, other),
      event(5, "EV_SYN", "SYN_DROPPED", 0),
      event(6, "EV_KEY", "BTN_TOUCH", 0, other),
      event(7, "EV_SYN", "SYN_REPORT", 0, other),
      event(8, "EV_KEY", "BTN_TOUCH", 1),
      event(9, "EV_ABS", "ABS_MT_POSITION_X", 50),
      event(10, "EV_ABS", "ABS_MT_POSITION_Y", 60),
      event(11, "EV_SYN", "SYN_REPORT", 0),
      event(12, "EV_KEY", "BTN_TOUCH", 0),
      event(13, "EV_SYN", "SYN_REPORT", 0),
    ]);
    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toEqual({
      startUs: 4, endUs: 7, durationMs: 0.003,
      points: [{ tUs: 4, x: 30, y: 40 }],
    });
    expect(gestures.warnings).toEqual([
      "/dev/input/event2 at 5: SYN_DROPPED; discarding unsynchronized gesture",
    ]);
  });

  test("reuses persistent slot coordinates for consecutive BTN_TOUCH-only contacts", () => {
    const events: InputEvent[] = [
      event(100, "EV_ABS", "ABS_MT_POSITION_X", 55),
      event(200, "EV_ABS", "ABS_MT_POSITION_Y", 66),
      event(1_000, "EV_KEY", "BTN_TOUCH", 1),
      event(10_000, "EV_SYN", "SYN_REPORT", 0),
      event(11_000, "EV_KEY", "BTN_TOUCH", 0),
      event(20_000, "EV_SYN", "SYN_REPORT", 0),
      event(21_000, "EV_KEY", "BTN_TOUCH", 1),
      event(30_000, "EV_SYN", "SYN_REPORT", 0),
      event(31_000, "EV_KEY", "BTN_TOUCH", 0),
      event(40_000, "EV_SYN", "SYN_REPORT", 0),
    ];
    const gestures = toGestures(events);
    expect(gestures.warnings).toEqual([]);
    expect(gestures).toHaveLength(2);
    expect(gestures[0]).toEqual({
      startUs: 10_000, endUs: 20_000, durationMs: 10,
      points: [{ tUs: 10_000, x: 55, y: 66 }],
    });
    expect(gestures[1]).toEqual({
      startUs: 30_000, endUs: 40_000, durationMs: 10,
      points: [{ tUs: 30_000, x: 55, y: 66 }],
    });
  });

  test("reuses slot-0 positions on new tracking ID without duplicate axis events", () => {
    const events: InputEvent[] = [
      event(1, "EV_ABS", "ABS_MT_TRACKING_ID", 12),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 70),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 80),
      event(10_000, "EV_SYN", "SYN_REPORT", 0),
      event(11_000, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(20_000, "EV_SYN", "SYN_REPORT", 0),
      event(21_000, "EV_ABS", "ABS_MT_TRACKING_ID", 13),
      event(30_000, "EV_SYN", "SYN_REPORT", 0),
      event(31_000, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(40_000, "EV_SYN", "SYN_REPORT", 0),
    ];
    const gestures = toGestures(events);
    expect(gestures.warnings).toEqual([]);
    expect(gestures).toHaveLength(2);
    expect(gestures[0]?.points).toEqual([{ tUs: 10_000, x: 70, y: 80 }]);
    expect(gestures[1]?.points).toEqual([{ tUs: 30_000, x: 70, y: 80 }]);
    expect(gestures[1]?.durationMs).toBe(10);
  });

  test("separates a same-frame lift/new tracking ID and preserves both paths", () => {
    const events: InputEvent[] = [
      event(10, "EV_ABS", "ABS_MT_TRACKING_ID", 1),
      event(20, "EV_ABS", "ABS_MT_POSITION_X", 10),
      event(30, "EV_ABS", "ABS_MT_POSITION_Y", 20),
      event(100_000, "EV_SYN", "SYN_REPORT", 0),
      event(150_000, "EV_ABS", "ABS_MT_POSITION_X", 15),
      event(150_010, "EV_ABS", "ABS_MT_POSITION_Y", 25),
      event(150_020, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(150_030, "EV_KEY", "BTN_TOUCH", 0),
      event(150_040, "EV_ABS", "ABS_MT_TRACKING_ID", 2),
      event(150_050, "EV_KEY", "BTN_TOUCH", 1),
      event(150_060, "EV_ABS", "ABS_MT_POSITION_X", 90),
      event(150_070, "EV_ABS", "ABS_MT_POSITION_Y", 120),
      event(200_000, "EV_SYN", "SYN_REPORT", 0),
      event(250_000, "EV_ABS", "ABS_MT_POSITION_X", 100),
      event(250_010, "EV_ABS", "ABS_MT_POSITION_Y", 130),
      event(300_000, "EV_SYN", "SYN_REPORT", 0),
      event(350_000, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(350_010, "EV_KEY", "BTN_TOUCH", 0),
      event(400_000, "EV_SYN", "SYN_REPORT", 0),
    ];
    const gestures = toGestures(events);
    expect(gestures.warnings).toEqual([]);
    expect(gestures).toHaveLength(2);
    expect(gestures[0]).toEqual({
      startUs: 100_000, endUs: 200_000, durationMs: 100,
      points: [
        { tUs: 100_000, x: 10, y: 20 },
        { tUs: 200_000, x: 15, y: 25 },
      ],
    });
    expect(gestures[1]).toEqual({
      startUs: 200_000, endUs: 400_000, durationMs: 200,
      points: [
        { tUs: 200_000, x: 90, y: 120 },
        { tUs: 300_000, x: 100, y: 130 },
      ],
    });
  });

  test("splits an implicit tracking-ID replacement without merging contacts", () => {
    const events: InputEvent[] = [
      event(1, "EV_ABS", "ABS_MT_TRACKING_ID", 8),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 10),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 20),
      event(10_000, "EV_SYN", "SYN_REPORT", 0),
      event(11_000, "EV_ABS", "ABS_MT_TRACKING_ID", 9),
      event(12_000, "EV_ABS", "ABS_MT_POSITION_X", 40),
      event(13_000, "EV_ABS", "ABS_MT_POSITION_Y", 50),
      event(20_000, "EV_SYN", "SYN_REPORT", 0),
      event(21_000, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(30_000, "EV_SYN", "SYN_REPORT", 0),
    ];
    const gestures = toGestures(events);
    expect(gestures).toHaveLength(2);
    expect(gestures.warnings).toHaveLength(1);
    expect(gestures.warnings[0]).toContain("tracking ID changed without lift");
    expect(gestures[0]).toEqual({
      startUs: 10_000, endUs: 20_000, durationMs: 10,
      points: [{ tUs: 10_000, x: 10, y: 20 }],
    });
    expect(gestures[1]).toEqual({
      startUs: 20_000, endUs: 30_000, durationMs: 10,
      points: [{ tUs: 20_000, x: 40, y: 50 }],
    });
  });

  test("does not lose two complete contacts within one SYN_REPORT", () => {
    const gestures = toGestures([
      event(1, "EV_ABS", "ABS_MT_TRACKING_ID", 8),
      event(2, "EV_ABS", "ABS_MT_POSITION_X", 10),
      event(3, "EV_ABS", "ABS_MT_POSITION_Y", 20),
      event(4, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(5, "EV_ABS", "ABS_MT_TRACKING_ID", 9),
      event(6, "EV_ABS", "ABS_MT_POSITION_X", 40),
      event(7, "EV_ABS", "ABS_MT_POSITION_Y", 50),
      event(8, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(10_000, "EV_SYN", "SYN_REPORT", 0),
    ]);
    expect(gestures.warnings).toEqual([]);
    expect(gestures).toHaveLength(2);
    expect(gestures[0]).toEqual({
      startUs: 10_000, endUs: 10_000, durationMs: 0,
      points: [{ tUs: 10_000, x: 10, y: 20 }],
    });
    expect(gestures[1]).toEqual({
      startUs: 10_000, endUs: 10_000, durationMs: 0,
      points: [{ tUs: 10_000, x: 40, y: 50 }],
    });
  });

  test("ignores secondary-only BTN_TOUCH transitions instead of making a ghost gesture", () => {
    const gestures = toGestures([
      event(1, "EV_ABS", "ABS_MT_SLOT", 1),
      event(2, "EV_ABS", "ABS_MT_TRACKING_ID", 5),
      event(3, "EV_ABS", "ABS_MT_POSITION_X", 999),
      event(4, "EV_ABS", "ABS_MT_POSITION_Y", 999),
      event(5, "EV_KEY", "BTN_TOUCH", 1),
      event(10_000, "EV_SYN", "SYN_REPORT", 0),
      event(11_000, "EV_ABS", "ABS_MT_TRACKING_ID", -1),
      event(12_000, "EV_KEY", "BTN_TOUCH", 0),
      event(20_000, "EV_SYN", "SYN_REPORT", 0),
    ]);
    expect(gestures).toHaveLength(0);
    expect(gestures.warnings).toContain("/dev/input/event2 at 10000: ignoring multi-touch slot 1");
  });

});

describe("replayPlan / toInputCommand", () => {
  test("scales endpoints inclusively, rounds pixels, and preserves 300ms duration", () => {
    const plan = replayPlan(singleGesture(), geometry);
    expect(plan).toEqual({
      kind: "swipe",
      x1: 540,
      y1: 1200,
      x2: 1079,
      y2: 1799,
      durationMs: 300,
    });
    expect(toInputCommand(plan)).toBe("input swipe 540 1200 1079 1799 300");
  });

  test("movement under 10 pixels is a tap at its first coordinate", () => {
    const tap: Gesture = {
      startUs: 0, endUs: 30_000, durationMs: 30,
      points: [{ tUs: 0, x: 10, y: 20 }, { tUs: 30_000, x: 15, y: 24 }],
    };
    const plan = replayPlan(tap, { maxX: 100, maxY: 100, screenW: 101, screenH: 101 });
    expect(plan).toEqual({ kind: "tap", x: 10, y: 20 });
    expect(toInputCommand(plan)).toBe("input tap 10 20");
  });

  test("uses cumulative path length, not net displacement, at 10px boundary", () => {
    const loop: Gesture = {
      startUs: 0, endUs: 250_000, durationMs: 250,
      points: [
        { tUs: 0, x: 100, y: 100 },
        { tUs: 100_000, x: 111, y: 100 },
        { tUs: 250_000, x: 100, y: 100 },
      ],
    };
    const plan = replayPlan(loop, { maxX: 200, maxY: 200, screenW: 201, screenH: 201 });
    expect(plan.kind).toBe("swipe");
    expect(toInputCommand(plan)).toBe("input swipe 100 100 100 100 250");
  });

  test("clamps out-of-range axes and rounds swipe duration to at least 1ms", () => {
    const gesture: Gesture = {
      startUs: 0, endUs: 100, durationMs: 0.1,
      points: [{ tUs: 0, x: -1, y: 10 }, { tUs: 100, x: 500, y: 500 }],
    };
    expect(replayPlan(gesture, { maxX: 100, maxY: 100, screenW: 101, screenH: 101 })).toEqual({
      kind: "swipe", x1: 0, y1: 10, x2: 100, y2: 100, durationMs: 1,
    });
  });

  test("rejects bad geometry and empty point streams", () => {
    expect(() => replayPlan(singleGesture(), { ...geometry, maxX: 0 })).toThrow(/maxX/);
    expect(() => replayPlan({ startUs: 0, endUs: 0, durationMs: 0, points: [] }, geometry))
      .toThrow(/no coordinate points/);
  });
});

describe("getevent CLI", () => {
  test("requires trace, maxima and screen dimensions", () => {
    expect(() => parseCliArgs([fixtureFile, "--max-x", "1000", "--max-y", "2000"]))
      .toThrow(/missing/);
    expect(() => parseCliArgs([fixtureFile, "--max-x", "abc", "--max-y", "2000", "--screen", "1080x2400"]))
      .toThrow(/invalid/);
  });

  test("exits 2 when --screen is missing", () => {
    const result = spawnSync(process.execPath, [
      scriptFile, fixtureFile, "--max-x", "1000", "--max-y", "2000",
    ], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing trace or axis/screen dimensions");
  });

  test("prints one exact replay command and supports structured JSON", () => {
    const argv = [scriptFile, fixtureFile, "--max-x", "1000", "--max-y", "2000", "--screen", "1080x2400"];
    const plain = spawnSync(process.execPath, argv, { encoding: "utf8" });
    expect(plain.status).toBe(0);
    expect(plain.stdout.trim()).toBe("input swipe 540 1200 1079 1799 300");

    const json = spawnSync(process.execPath, [...argv, "--json"], { encoding: "utf8" });
    expect(json.status).toBe(0);
    expect(json.stdout).toContain('"kind": "swipe"');
    expect(json.stdout).toContain('"commands": [');
    expect(json.stdout).toContain("input swipe 540 1200 1079 1799 300");
  });
});
