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
