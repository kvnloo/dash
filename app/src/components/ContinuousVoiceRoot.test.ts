import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ContinuousVoiceRoot.tsx", import.meta.url), "utf8");

describe("continuous voice error pill", () => {
  test("shows one error line with separate Retry and End controls", () => {
    expect(source).toContain('testID="voice-error"');
    expect(source).toContain('accessibilityRole="alert" accessibilityLiveRegion="polite"');
    expect(source).toMatch(/testID="voice-error"[^>]+numberOfLines=\{1\}/);
    expect(source).toContain('testID={pill.phase === "error" ? "voice-retry"');
    expect(source).toContain('primaryText');
    expect(source).toContain('testID="voice-end"');
    expect(source).toContain('accessibilityLabel="End voice call and dismiss error"');
    expect(source).toContain('onPress={() => void stop()}');
    expect(source).toContain('errorLabel: { color: colors.danger');
    expect(source).toContain('minHeight: 44, minWidth: 56');
  });

  test("classifies native load, SDP negotiation and token failures at their actual call sites", () => {
    expect(source).toContain('protectVoicePeer(await createVoicePeer(event, ready, lost))');
    expect(source).toContain('error instanceof Error && /permission denied/i.test(error.message) ? "permission" : "webrtc"');
    expect(source).toContain('if (response.status === 401 || response.status === 403) throw new VoiceAccessDenied(voiceConnectionError("token"));');
    expect(source).toContain('if (!response.ok) throw new VoiceAccessDenied(voiceConnectionError("sdp"));');
    expect(source).toContain('if (!sdp.startsWith("v=0")) throw new VoiceAccessDenied(voiceConnectionError("sdp"));');
    expect(source).toContain('voiceConnectionErrorLine(next.note)');
    expect(source).not.toContain('Linking.openURL');
  });

  test("retry waits for native release and targets the same attached Hermes conversation", () => {
    const wait = source.indexOf("await micRelease.current.wait()");
    const acquire = source.indexOf('microphone.acquire("live")');
    expect(wait).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(wait);
    expect(source).toContain("if (beforeWait !== epoch.current) return;");
    expect(source).toContain('state.phase === "error" ? attached.current : null');
    expect(source).toContain("const releaseWhenStopped = micRelease.current.hold(release)");
    expect(source).toContain("captureReleased: () => { releaseWhenStopped();");
    expect(source).toContain("releaseWhenStopped(); if (releaseMic.current === releaseWhenStopped)");
  });

  test("End invalidates stale work, clears target and returns to idle", () => {
    expect(source).toContain("epoch.current++; starting.current = false; desiredMute.current = false;");
    expect(source).toContain("call.current = null;");
    expect(source).toContain("attached.current = null;");
    expect(source).toContain("const cleanup = controller?.stop();");
    expect(source).toContain("setState(initial); await cleanup;");
  });
});
