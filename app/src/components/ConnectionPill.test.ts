import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { connectionBannerFor, createConnectionRetry } from "./connection-banner";

describe("bridge connection banner decisions", () => {
  test("no warning for online or idle, even with a stale error", () => {
    expect(connectionBannerFor({ status: "online", error: "Old network failure" })).toBeNull();
    expect(connectionBannerFor({ status: "idle" })).toBeNull();
  });

  test("offline shows the actual trimmed failure and keeps queued drafts visible", () => {
    const banner = connectionBannerFor({ status: "offline", error: "  Timed out connecting  " });
    expect(banner).toEqual({
      connecting: false,
      heading: "Bridge unreachable",
      detail: "Timed out connecting · Queued drafts kept",
      retryLabel: "Retry bridge connection",
      retryText: "Retry",
      liveRegion: "polite",
    });
    expect(banner?.detail).not.toContain("Tailscale is down");
  });

  test("no response uses an honest check, not an invented outage diagnosis", () => {
    for (const error of [undefined, "", "  \n  "]) {
      const banner = connectionBannerFor({ status: "offline", error });
      expect(banner?.detail).toBe(
        "No response. Check Tailscale on your phone and computer. · Queued drafts kept",
      );
    }
  });

  test("connecting ignores stale failures and disables retry with non-live copy", () => {
    expect(connectionBannerFor({ status: "connecting", error: "Previous timeout" })).toEqual({
      connecting: true,
      heading: "Connecting to bridge",
      detail: "Waiting for the saved bridge to respond.",
      retryLabel: "Connecting to bridge",
      retryText: "Trying…",
      liveRegion: "none",
    });
  });

  test("the banner decision does not mutate connection data or queued drafts", () => {
    const drafts = [{ id: "queued-1", text: "Unsaved prompt" }];
    const connection: { status: "offline"; error: string; queuedDrafts: typeof drafts } = {
      status: "offline",
      error: "  Connection closed  ",
      queuedDrafts: drafts,
    };
    const result = connectionBannerFor(connection);
    expect(result?.detail).toContain("Connection closed");
    expect(connection.error).toBe("  Connection closed  ");
    expect(connection.queuedDrafts).toBe(drafts);
    expect(drafts).toEqual([{ id: "queued-1", text: "Unsaved prompt" }]);
  });
});

describe("bridge retry guard", () => {
  test("a rapid double-tap requests one retry and a later offline attempt can retry", () => {
    let retryCalls = 0;
    const retryBridge = () => { retryCalls += 1; };
    const failedAttempt = createConnectionRetry(false, retryBridge);
    failedAttempt();
    failedAttempt();
    expect(retryCalls).toBe(1);

    const stillConnecting = createConnectionRetry(true, retryBridge);
    stillConnecting();
    stillConnecting();
    expect(retryCalls).toBe(1);

    const failedAgain = createConnectionRetry(false, retryBridge);
    failedAgain();
    failedAgain();
    expect(retryCalls).toBe(2);
  });

  test("an immediate bridge exception does not permanently consume retry", () => {
    let attempts = 0;
    const retry = createConnectionRetry(false, () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Bridge unavailable");
    });

    expect(retry).toThrow("Bridge unavailable");
    expect(retry).not.toThrow();
    retry();
    expect(attempts).toBe(2);
  });
});

describe("native connection banner source contracts", () => {
  const source = readFileSync(new URL("./ConnectionPill.tsx", import.meta.url), "utf8");

  test("component uses the independently tested decisions and only retries the bridge", () => {
    expect(source).toContain("const banner = connectionBannerFor(connection);");
    expect(source).toContain("const retry = createConnectionRetry(banner.connecting, () => bridge.retry());");
    expect(source).toContain("onPress={retry}");
    expect(source).not.toMatch(/clearQueued|removeQueued|dequeue|flushPendingSends|clearDrafts|setConnection\(/);
  });

  test("native accessibility and 44-DIP hit target remain wired", () => {
    expect(source).toContain('testID="connection-banner"');
    expect(source).toContain('testID="connection-retry"');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessibilityLabel={banner.retryLabel}");
    expect(source).toContain("accessibilityLiveRegion={banner.liveRegion}");
    expect(source).toContain("accessibilityState={{ disabled: banner.connecting, busy: banner.connecting }}");
    expect(source).toContain("disabled={banner.connecting}");
    expect(source).toContain("Queued drafts stay on this phone.");
    expect(source).toContain("minHeight: controlMin");
    expect(source).toContain("minWidth: controlMin");
    const theme = readFileSync(new URL("../theme.ts", import.meta.url), "utf8");
    expect(theme).toMatch(/export const controlMin = 44\b/);
  });

  test("banner has 110ms ease-out and reduced-motion behavior without spring", () => {
    expect(source).toContain("FadeIn.duration(110)");
    expect(source).toContain("FadeOut.duration(110)");
    expect(source).toContain("Easing.out(Easing.cubic)");
    expect(source).toContain("reduceMotion(ReduceMotion.System)");
    expect(source).not.toContain("withSpring");
    expect(source).toContain("numberOfLines={2}");
  });

  test("test imports are isolated: no process-wide Bun module mocks", () => {
    const self = readFileSync(new URL("./ConnectionPill.test.ts", import.meta.url), "utf8");
    expect(self).not.toContain("mock" + ".module(");
    expect(self).not.toMatch(/from ["']\.\.\/(theme|store\/app|net\/bridge)["']/);
  });
});
