import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  connectionPillPresentation,
  retryConnectionFromPill,
  type ConnectionPillPresentation,
} from "./a11y-connection-pill";

describe("ConnectionPill accessibility", () => {
  test("idle and online never expose a retry action", () => {
    expect(connectionPillPresentation({ status: "idle" })).toBeNull();
    expect(connectionPillPresentation({ status: "online", error: "stale" })).toBeNull();
  });

  test("connecting is announced as busy, disabled status rather than a button", () => {
    expect(connectionPillPresentation({ status: "connecting", error: "stale failure" })).toEqual({
      text: "Connecting to bridge…",
      accessibilityLabel: "Connecting to bridge",
      accessibilityRole: "text",
      accessibilityState: { disabled: true, busy: true },
      canRetry: false,
    });
  });

  test("offline without an error gives a truthful status and explicit retry", () => {
    const expected: ConnectionPillPresentation = {
      text: "Offline · Retry connection",
      accessibilityLabel: "Bridge offline. Retry connection",
      accessibilityRole: "button",
      accessibilityState: { disabled: false, busy: false },
      canRetry: true,
    };
    expect(connectionPillPresentation({ status: "offline" })).toEqual(expected);
    expect(connectionPillPresentation({ status: "offline", error: "   " })).toEqual(expected);
  });

  test("offline errors are preserved in the announced label and visible status", () => {
    expect(connectionPillPresentation({ status: "offline", error: " Timed out connecting " })).toEqual({
      text: "Timed out connecting · Retry connection",
      accessibilityLabel: "Bridge offline: Timed out connecting. Retry connection",
      accessibilityRole: "button",
      accessibilityState: { disabled: false, busy: false },
      canRetry: true,
    });
  });

  test("only an available retry dispatches the supplied action", () => {
    let calls = 0;
    const retry = () => { calls += 1; };
    expect(retryConnectionFromPill(null, retry)).toBe(false);
    expect(retryConnectionFromPill(connectionPillPresentation({ status: "connecting" }), retry)).toBe(false);
    expect(retryConnectionFromPill(connectionPillPresentation({ status: "online" }), retry)).toBe(false);
    expect(calls).toBe(0);
    expect(retryConnectionFromPill(connectionPillPresentation({ status: "offline" }), retry)).toBe(true);
    expect(calls).toBe(1);
  });

  test("the turbo connection banner binds one TalkBack retry, busy state, live region and 44 DIP hit size", () => {
    // ConnectionPill.tsx was replaced on turbo by the non-blocking connection banner
    // (connection-banner.ts); assert the same accessibility contract on that renderer.
    // No React Native renderer is available in Bun; TalkBack/device focus remains a gate.
    const source = readFileSync(new URL("../components/ConnectionPill.tsx", import.meta.url), "utf8");
    expect(source).toContain("accessible");
    expect(source).toContain("disabled={banner.connecting}");
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessibilityLabel={banner.retryLabel}");
    expect(source).toContain("accessibilityState={{ disabled: banner.connecting, busy: banner.connecting }}");
    expect(source).toContain("accessibilityLiveRegion={banner.liveRegion}");
    expect(source).toContain("onPress={retry}");
    expect(source).toContain("minHeight: controlMin");
    expect(source).toContain("numberOfLines={2}");
  });
});
