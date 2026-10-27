import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { voiceBarVisible, voiceControlHome } from "../lib/voice-bar";

const source = (path: string): string => readFileSync(join(import.meta.dir, path), "utf8");

describe("root-owned voice survives in-app navigation", () => {
  test("one ContinuousVoiceRoot wraps the stack instead of living inside a chat or pager page", () => {
    const app = source("../../App.tsx");
    const owner = app.indexOf("<ContinuousVoiceRoot>");
    const stack = app.indexOf("<Stack.Navigator");
    const stackEnd = app.indexOf("</Stack.Navigator>");
    const ownerEnd = app.indexOf("</ContinuousVoiceRoot>");
    expect(owner).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(owner);
    expect(stackEnd).toBeGreaterThan(stack);
    expect(ownerEnd).toBeGreaterThan(stackEnd);
    expect(app.match(/<ContinuousVoiceRoot>/g)).toHaveLength(1);
  });

  test("closing a chat window unmounts its controls, not the call", () => {
    const chat = source("../screens/ChatScreen.tsx");
    expect(chat).toMatch(/if \(!windowed\) return;\s*voiceWindowOpen\.set\(true\);\s*return \(\) => voiceWindowOpen\.set\(false\);\s*\}, \[windowed\]\);/);
    const closeStart = chat.indexOf("const closeWindow = useCallback");
    const closeEnd = chat.indexOf("const layers = useRef", closeStart);
    expect(closeStart).toBeGreaterThan(-1);
    expect(closeEnd).toBeGreaterThan(closeStart);
    const close = chat.slice(closeStart, closeEnd);
    expect(close).toContain("morph.close(() => screenBack(navigation))");
    expect(close).not.toMatch(/(?:voice|call|controller)\??\.stop\(/);
    const root = source("ContinuousVoiceRoot.tsx");
    expect(root).toContain("const windowOpen = voiceWindowOpen.use(open => open);");
    // Closing the window relocates controls without ending the root-owned call.
    expect(root).toMatch(/voiceControlHome\(\s*visible\s*,\s*windowOpen\s*\)/);
    expect(voiceBarVisible("error", false)).toBe(true);
    for (const visible of [voiceBarVisible("listening", true), voiceBarVisible("error", false)]) {
      expect(voiceControlHome(visible, true)).toBe("window");
      expect(voiceControlHome(visible, false)).toBe("bar");
    }
  });

  test("pager selection does not tear down root effects; only app background or root unmount does", () => {
    const main = source("../screens/MainScreen.tsx");
    expect(main).toContain("onPageSelected={onPage}");
    expect(main).toContain("pagerRef.current?.setPage(next)");
    const root = source("ContinuousVoiceRoot.tsx");
    const lifetimeStart = root.indexOf('useEffect(() => {\n    const subscription = AppState.addEventListener');
    const lifetimeEnd = root.indexOf("  const shown =", lifetimeStart);
    expect(lifetimeStart).toBeGreaterThan(-1);
    expect(lifetimeEnd).toBeGreaterThan(lifetimeStart);
    const lifetime = root.slice(lifetimeStart, lifetimeEnd);
    expect(lifetime).toContain('if (next === "background")');
    expect(lifetime).toContain("subscription.remove()");
    expect(lifetime).toContain("void controller?.stop()");
    expect(lifetime).toMatch(/\}, \[\]\);/);
  });

  test("entering annotation starts conversation voice; leaving ends only the call annotation started", () => {
    const root = source("ContinuousVoiceRoot.tsx");
    expect(root).toContain("const annotating = annotate.use(s => s.active);");
    const at = root.indexOf("if (annotating) {");
    expect(at).toBeGreaterThan(-1);
    const effect = root.slice(at, root.indexOf("}, [annotating]);", at));
    expect(effect).toMatch(/\["idle", "error"\]\.includes\(phase\) && !starting\.current\) \{ autoStarted\.current = true; void begin\(\); \}/);
    expect(effect).toMatch(/else if \(autoStarted\.current\) \{\s*autoStarted\.current = false;\s*void end\(\);/);
  });
});

const errorPillSource = readFileSync(new URL("./ContinuousVoiceRoot.tsx", import.meta.url), "utf8");
describe("continuous voice error pill", () => {
  test("shows one error line with separate Retry and End controls", () => {
    expect(errorPillSource).toContain('testID="voice-error"');
    expect(errorPillSource).toContain('accessibilityRole="alert" accessibilityLiveRegion="polite"');
    expect(errorPillSource).toMatch(/testID="voice-error"[^>]+numberOfLines=\{1\}/);
    expect(errorPillSource).toContain('testID={pill.phase === "error" ? "voice-retry"');
    expect(errorPillSource).toContain('primaryText');
    expect(errorPillSource).toContain('testID="voice-end"');
    expect(errorPillSource).toContain('accessibilityLabel="End voice call and dismiss error"');
    expect(errorPillSource).toContain('onPress={() => void stop()}');
    expect(errorPillSource).toContain('errorLabel: { color: colors.danger');
    expect(errorPillSource).toContain('minHeight: 44, minWidth: 56');
  });

  test("classifies native load, SDP negotiation and token failures at their actual call sites", () => {
    expect(errorPillSource).toContain('protectVoicePeer(await createVoicePeer(event, ready, lost))');
    expect(errorPillSource).toContain('error instanceof Error && /permission denied/i.test(error.message) ? "permission" : "webrtc"');
    expect(errorPillSource).toContain('if (response.status === 401 || response.status === 403) throw new VoiceAccessDenied(voiceConnectionError("token"));');
    expect(errorPillSource).toContain('if (!response.ok) throw new VoiceAccessDenied(voiceConnectionError("sdp"));');
    expect(errorPillSource).toContain('if (!sdp.startsWith("v=0")) throw new VoiceAccessDenied(voiceConnectionError("sdp"));');
    expect(errorPillSource).toContain('voiceConnectionErrorLine(next.note)');
    expect(errorPillSource).not.toContain('Linking.openURL');
  });

  test("retry waits for native release and targets the same attached Hermes conversation", () => {
    const wait = errorPillSource.indexOf("await micRelease.current.wait()");
    const acquire = errorPillSource.indexOf('microphone.acquire("live")');
    expect(wait).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(wait);
    expect(errorPillSource).toContain("if (beforeWait !== epoch.current) return;");
    expect(errorPillSource).toContain('state.phase === "error" ? attached.current : null');
    expect(errorPillSource).toContain("const releaseWhenStopped = micRelease.current.hold(release)");
    expect(errorPillSource).toContain("captureReleased: () => { releaseWhenStopped();");
    expect(errorPillSource).toContain("releaseWhenStopped(); if (releaseMic.current === releaseWhenStopped)");
  });

  test("End invalidates stale work, clears target and returns to idle", () => {
    expect(errorPillSource).toContain("epoch.current++; starting.current = false; desiredMute.current = false;");
    expect(errorPillSource).toContain("call.current = null;");
    expect(errorPillSource).toContain("attached.current = null;");
    expect(errorPillSource).toContain("const cleanup = controller?.stop();");
    expect(errorPillSource).toContain("setState(initial); await cleanup;");
  });
});
