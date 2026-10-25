import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Connection } from "../model";

let connection: Pick<Connection, "status" | "error"> = { status: "idle" };
let retryCalls = 0;

// Render the component tree without booting the native bridge or a phone.
mock.module("react-native", () => ({
  StyleSheet: { create: <T extends object>(styles: T): T => styles },
  Text: "Text",
  View: "View",
}));
const animation = {
  duration(_ms: number) { return this; },
  easing(_ease: unknown) { return this; },
  reduceMotion(_setting: unknown) { return this; },
};
mock.module("react-native-reanimated", () => ({
  default: { View: "Animated.View" },
  Easing: { out: () => "ease-out", cubic: () => "cubic" },
  FadeIn: animation,
  FadeOut: animation,
  ReduceMotion: { System: "system" },
}));
mock.module("../motion", () => ({ PRESS_SCALE: { control: 0.92 } }));
mock.module("../net/bridge", () => ({ bridge: { retry: () => { retryCalls += 1; } } }));
mock.module("../store/app", () => ({
  store: {
    use: (selector: (state: { connection: typeof connection }) => unknown): unknown =>
      selector({ connection }),
  },
}));
mock.module("../theme", () => ({
  colors: { warn: "#ffb020", text: "#f2f2f2", textMuted: "#8b8b8b" },
  controlMin: 44,
  glass: { hair2: "#262626", fillChipOn: "#121212" },
  radius: { md: 16, pill: 999 },
  space: { xs: 4, sm: 8, md: 12 },
  type: { small: { fontSize: 13 }, label: { fontSize: 12 } },
}));
mock.module("./GlassSurface", () => ({ GlassSurface: "GlassSurface" }));
mock.module("./PressScale", () => ({ PressScale: "PressScale" }));

const { ConnectionPill } = await import("./ConnectionPill");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propsFor(node: unknown, testID: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsFor(child, testID);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(node) || !isRecord(node.props)) return undefined;
  if (node.props.testID === testID) return node.props;
  return propsFor(node.props.children, testID);
}

function visibleText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (isRecord(node) && isRecord(node.props)) return visibleText(node.props.children);
  return "";
}

function render(status: Connection["status"], error?: string) {
  connection = { status, error };
  return ConnectionPill();
}

function pressRetry(tree: unknown): void {
  const retry = propsFor(tree, "connection-retry");
  if (typeof retry?.onPress !== "function") throw new Error("Retry control missing");
  retry.onPress();
}

beforeEach(() => {
  connection = { status: "idle" };
  retryCalls = 0;
});

describe("bridge connection banner", () => {
  test("does not claim an outage while online or unpaired", () => {
    expect(render("online")).toBeNull();
    expect(render("idle")).toBeNull();
  });

  test("unreachable bridge shows the actual failure, a retry, and keeps drafts visible", () => {
    const tree = render("offline", "  Timed out connecting  ");
    const copy = propsFor(tree, "connection-banner-copy");
    const retry = propsFor(tree, "connection-retry");

    expect(propsFor(tree, "connection-banner")).toBeDefined();
    expect(visibleText(tree)).toContain("Bridge unreachable");
    expect(visibleText(tree)).toContain("Timed out connecting");
    expect(visibleText(tree)).toContain("Queued drafts kept");
    expect(visibleText(tree)).not.toContain("Tailscale is down");
    expect(copy?.accessibilityLabel).toContain("Timed out connecting");
    expect(copy?.accessibilityLiveRegion).toBe("polite");
    expect(retry?.accessibilityLabel).toBe("Retry bridge connection");
    expect(retry?.disabled).toBe(false);
  });

  test("unknown cellular failure offers a check, not an invented diagnosis", () => {
    const tree = render("offline");
    expect(visibleText(tree)).toContain("No response");
    expect(visibleText(tree)).toContain("Check Tailscale on your phone and computer.");
    expect(visibleText(tree)).toContain("Queued drafts kept");
  });

  test("Retry invokes only one immediate reconnect per failed attempt", () => {
    const offline = render("offline", "Can't reach the bridge");
    pressRetry(offline);
    pressRetry(offline);
    expect(retryCalls).toBe(1);

    const connecting = render("connecting");
    pressRetry(connecting);
    expect(retryCalls).toBe(1);

    const failedAgain = render("offline", "Timed out connecting");
    pressRetry(failedAgain);
    expect(retryCalls).toBe(2);
  });

  test("connection attempt remains visible but cannot spawn another retry", () => {
    const tree = render("connecting");
    const retry = propsFor(tree, "connection-retry");
    const copy = propsFor(tree, "connection-banner-copy");
    expect(visibleText(tree)).toContain("Connecting to bridge");
    expect(visibleText(tree)).not.toContain("Bridge unreachable");
    expect(retry?.disabled).toBe(true);
    expect(retry?.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(copy?.accessibilityLiveRegion).toBe("none");
    pressRetry(tree);
    expect(retryCalls).toBe(0);
  });

  test("retry has a native 44-DIP target, clear TalkBack copy, and reduced motion", () => {
    const tree = render("offline", "Connection closed");
    const retry = propsFor(tree, "connection-retry");
    expect(retry?.accessibilityRole).toBe("button");
    expect(retry?.accessibilityHint).toContain("Queued drafts stay on this phone");
    expect(retry?.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(retry?.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ minHeight: 44, minWidth: 44 }),
    ]));

    const source = readFileSync(new URL("./ConnectionPill.tsx", import.meta.url), "utf8");
    expect(source).toContain("FadeIn.duration(110)");
    expect(source).toContain("FadeOut.duration(110)");
    expect(source).toContain("Easing.out(Easing.cubic)");
    expect(source).toContain("reduceMotion(ReduceMotion.System)");
    expect(source).not.toContain("withSpring");
  });

  test("banner only requests bridge retry; it never clears or drains queued drafts", () => {
    const source = readFileSync(new URL("./ConnectionPill.tsx", import.meta.url), "utf8");
    expect(source).toContain("bridge.retry()");
    expect(source).not.toMatch(/clearQueued|removeQueued|dequeue|flushPendingSends|clearDrafts/);
    expect(source).not.toContain("setConnection(");
  });
});
