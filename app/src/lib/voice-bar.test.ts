import { describe, expect, test } from "bun:test";
import type { VoiceState } from "./continuous-voice";
import { appInsets, VOICE_BAR_ROW, voiceBarPresentation, voiceBarVisible, voiceControlHome } from "./voice-bar";

const device = { top: 40, bottom: 24, left: 0, right: 0 };

describe("app-wide voice pill owns layout space", () => {
  test("fresh idle call: device insets unchanged (same object)", () => {
    expect(appInsets(device, false, 50)).toBe(device);
    expect(voiceBarVisible("idle", false)).toBe(false);
  });
  test("visible pill: top grows by measured row, other edges untouched", () => {
    expect(appInsets(device, true, 52)).toEqual({ top: 92, bottom: 24, left: 0, right: 0 });
    expect(device).toEqual({ top: 40, bottom: 24, left: 0, right: 0 });
  });
  test("before measurement or bad measurements: fixed fallback row, never zero", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(appInsets(device, true, bad).top).toBe(40 + VOICE_BAR_ROW);
    }
    expect(appInsets(device, true).top).toBe(40 + VOICE_BAR_ROW);
    expect(VOICE_BAR_ROW).toBe(46);
  });
  test("error and ended calls keep a pill for Retry/Start; untouched idle does not", () => {
    expect(voiceBarVisible("connecting", false)).toBe(true);
    expect(voiceBarVisible("error", false)).toBe(true);
    expect(voiceBarVisible("idle", true)).toBe(true);
    expect(appInsets(device, voiceBarVisible("idle", true), 46).top).toBe(86);
  });
});

describe("one home for voice controls", () => {
  test("window dock while open, pill otherwise, none before first call", () => {
    expect(voiceControlHome(false, false)).toBe("none");
    expect(voiceControlHome(false, true)).toBe("none");
    expect(voiceControlHome(true, false)).toBe("bar");
    expect(voiceControlHome(true, true)).toBe("window");
  });
  test("an error is still routed to one home, never both", () => {
    for (const windowOpen of [false, true]) {
      const home = voiceControlHome(voiceBarVisible("error", false), windowOpen);
      expect(home).toBe(windowOpen ? "window" : "bar");
    }
  });
});

describe("voice pill phase and actions", () => {
  test("idle after End exposes in-Dash Start, with no stale mute or end action", () => {
    expect(voiceBarPresentation({ phase: "idle", muted: false })).toEqual({
      phase: "idle", label: "Voice idle", action: "start",
      primaryText: "Start", primaryLabel: "Start voice in Dash",
    });
  });
  test("connection has Cancel and Mute, and remains connecting when muted", () => {
    expect(voiceBarPresentation({ phase: "connecting", muted: false })).toEqual({
      phase: "connecting", label: "Voice connecting", action: "end",
      primaryText: "Cancel", primaryLabel: "Cancel voice connection", muteText: "Mute",
    });
    expect(voiceBarPresentation({ phase: "connecting", muted: true })).toEqual({
      phase: "connecting", label: "Voice connecting · mic muted", action: "end",
      primaryText: "Cancel", primaryLabel: "Cancel voice connection", muteText: "Unmute",
    });
  });
  test("every live transport phase exposes the same Mute/End set", () => {
    const phases: VoiceState["phase"][] = ["listening", "hearing", "thinking", "speaking"];
    for (const phase of phases) {
      expect(voiceBarPresentation({ phase, muted: false })).toEqual({
        phase: "live", label: "Voice live · " + phase, action: "end",
        primaryText: "End", primaryLabel: "End voice call", muteText: "Mute",
      });
    }
  });
  test("muting a live call changes the status and action to Unmute, not End", () => {
    expect(voiceBarPresentation({ phase: "speaking", muted: true })).toEqual({
      phase: "muted", label: "Voice live · mic muted", action: "end",
      primaryText: "End", primaryLabel: "End voice call", muteText: "Unmute",
    });
  });
  test("error exposes real failure detail and Retry; it never claims a live microphone", () => {
    expect(voiceBarPresentation({ phase: "error", muted: false, note: "Mic permission denied" })).toEqual({
      phase: "error", label: "Voice error", detail: "Mic permission denied",
      action: "start", primaryText: "Retry", primaryLabel: "Retry voice in Dash",
    });
    expect(voiceBarPresentation({ phase: "error", muted: true }).action).toBe("start");
  });
  test("recovery to connecting or live never carries an old error note into the pill", () => {
    expect(voiceBarPresentation({ phase: "connecting", muted: false, note: "Old error" })).not.toHaveProperty("detail");
    expect(voiceBarPresentation({ phase: "listening", muted: false, note: "Old error" })).not.toHaveProperty("detail");
  });
});
