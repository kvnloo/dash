import { describe, expect, test } from "bun:test";
import { appInsets, VOICE_BAR_ROW, voiceControlHome } from "./voice-bar";

const device = { top: 40, bottom: 24, left: 0, right: 0 };

describe("app-wide voice bar owns layout space", () => {
  test("no call: device insets unchanged (same object)", () => {
    expect(appInsets(device, false, 50)).toBe(device);
  });
  test("live call: top grows by the measured bar row; other edges untouched", () => {
    expect(appInsets(device, true, 52)).toEqual({ top: 92, bottom: 24, left: 0, right: 0 });
  });
  test("before measurement or bad measurements: fixed fallback row, never zero", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) expect(appInsets(device, true, bad).top).toBe(40 + VOICE_BAR_ROW);
    expect(appInsets(device, true).top).toBe(40 + VOICE_BAR_ROW);
    expect(VOICE_BAR_ROW).toBe(46);
  });
});

describe("one home for voice Mute/End", () => {
  test("window dock row while a chat window is open, the bar otherwise, nothing when idle", () => {
    expect(voiceControlHome(false, false)).toBe("none");
    expect(voiceControlHome(false, true)).toBe("none");
    expect(voiceControlHome(true, false)).toBe("bar");
    expect(voiceControlHome(true, true)).toBe("window");
  });
});
