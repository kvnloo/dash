import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VoiceState } from "./continuous-voice";
import { appInsets, VOICE_BAR_ROW, voiceBarPresentation, voiceBarVisible, voiceControlHome, voiceMuteAccessibilityLabel, voiceStatusAccessibilityLabel } from "./voice-bar";

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
      primaryText: "Start", primaryLabel: "Start voice",
    });
  });
  test("connection has Cancel and Mute, and remains connecting when muted", () => {
    expect(voiceBarPresentation({ phase: "connecting", muted: false })).toEqual({
      phase: "connecting", label: "Voice connecting", action: "end",
      primaryText: "Cancel", primaryLabel: "End voice", muteText: "Mute",
    });
    expect(voiceBarPresentation({ phase: "connecting", muted: true })).toEqual({
      phase: "connecting", label: "Voice connecting · mic muted", action: "end",
      primaryText: "Cancel", primaryLabel: "End voice", muteText: "Unmute",
    });
  });
  test("every live transport phase exposes the same Mute/End set", () => {
    const phases: VoiceState["phase"][] = ["listening", "hearing", "thinking", "speaking"];
    for (const phase of phases) {
      expect(voiceBarPresentation({ phase, muted: false })).toEqual({
        phase: "live", label: "Voice live · " + phase, action: "end",
        primaryText: "End", primaryLabel: "End voice", muteText: "Mute",
      });
    }
  });
  test("muting a live call changes the status and action to Unmute, not End", () => {
    expect(voiceBarPresentation({ phase: "speaking", muted: true })).toEqual({
      phase: "muted", label: "Voice live · mic muted", action: "end",
      primaryText: "End", primaryLabel: "End voice", muteText: "Unmute",
    });
  });
  test("error exposes real failure detail and Retry; it never claims a live microphone", () => {
    expect(voiceBarPresentation({ phase: "error", muted: false, note: "Mic permission denied" })).toEqual({
      phase: "error", label: "Voice error", detail: "Mic permission denied",
      action: "start", primaryText: "Retry", primaryLabel: "Start voice",
    });
    expect(voiceBarPresentation({ phase: "error", muted: true }).action).toBe("start");
  });
  test("recovery to connecting or live never carries an old error note into the pill", () => {
    expect(voiceBarPresentation({ phase: "connecting", muted: false, note: "Old error" })).not.toHaveProperty("detail");
    expect(voiceBarPresentation({ phase: "listening", muted: false, note: "Old error" })).not.toHaveProperty("detail");
  });
});

describe("coordinate-free Android voice journeys", () => {
  test("Start/Retry and Cancel/End have the same exact action selectors", () => {
    const startPhases: VoiceState["phase"][] = ["idle", "error"];
    for (const phase of startPhases) {
      const pill = voiceBarPresentation({ phase, muted: false });
      expect(pill.action).toBe("start");
      expect(pill.primaryLabel).toBe("Start voice");
    }

    const endPhases: VoiceState["phase"][] = ["connecting", "listening", "hearing", "thinking", "speaking"];
    for (const phase of endPhases) {
      const pill = voiceBarPresentation({ phase, muted: false });
      expect(pill.action).toBe("end");
      expect(pill.primaryLabel).toBe("End voice");
    }
    expect(voiceBarPresentation({ phase: "speaking", muted: true }).primaryLabel).toBe("End voice");
  });

  test("status content descriptions track phase, error, and live mute", () => {
    const phases: VoiceState["phase"][] = ["idle", "connecting", "listening", "hearing", "thinking", "speaking", "error"];
    for (const phase of phases) {
      expect(voiceStatusAccessibilityLabel({ phase, muted: false })).toBe(`Voice status: ${phase}`);
    }
    const livePhases: VoiceState["phase"][] = ["listening", "hearing", "thinking", "speaking"];
    for (const phase of livePhases) {
      expect(voiceStatusAccessibilityLabel({ phase, muted: true })).toBe("Voice status: muted");
    }
    expect(voiceStatusAccessibilityLabel({ phase: "connecting", muted: true })).toBe("Voice status: connecting");
    expect(voiceStatusAccessibilityLabel({ phase: "error", muted: true })).toBe("Voice status: error");
    expect(voiceStatusAccessibilityLabel({ phase: "idle", muted: true })).toBe("Voice status: idle");
  });

  test("microphone accessibility label always names the next action", () => {
    expect(voiceMuteAccessibilityLabel(false)).toBe("Mute voice");
    expect(voiceMuteAccessibilityLabel(true)).toBe("Unmute voice");
  });

  test("native Pressables and live status Text expose selectors without coordinates", () => {
    const source = readFileSync(join(import.meta.dir, "../components/ContinuousVoiceRoot.tsx"), "utf8");
    expect(source).toMatch(/<Text testID="voice-phase" accessible accessibilityLabel=\{voiceStatusAccessibilityLabel\(shown\)\}/);
    expect(source).toContain('accessibilityLiveRegion="polite"');
    expect(source).toMatch(/testID="voice-mute"\s+accessibilityRole="button"\s+accessibilityLabel=\{voiceMuteAccessibilityLabel\(shown\.muted\)\}/);
    expect(source).toMatch(/testID=\{pill\.action === "start" \? "voice-start" : "voice-end"\}\s+accessibilityRole="button"\s+accessibilityLabel=\{pill\.primaryLabel\}/);
    expect(source).toContain("onPress={mute}");
    expect(source).toContain('accessibilityState={{ selected: shown.muted }}');
  });
});
