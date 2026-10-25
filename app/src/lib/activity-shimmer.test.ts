import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage, ConnectionStatus } from "../model";
import type { ThinkingPhase } from "./thinking";
import { conversationThinking } from "./thinking";
import { activityShimmerEnabled, SHIMMER_END, SHIMMER_REST_MS, SHIMMER_START, SHIMMER_SWEEP_MS, shimmerStops } from "./activity-shimmer";

describe("live activity shimmer", () => {
  test("only live thinking, tool calls and streaming replies animate", () => {
    const livePhases: ThinkingPhase[] = ["thinking", "tool", "streaming"];
    for (const phase of livePhases) {
      expect(activityShimmerEnabled(phase, "online", false)).toBe(true);
      expect(activityShimmerEnabled(phase, "online", true)).toBe(false);
      const offlineStatuses: ConnectionStatus[] = ["idle", "connecting", "offline"];
      for (const connection of offlineStatuses) {
        expect(activityShimmerEnabled(phase, connection, false)).toBe(false);
      }
    }
    expect(activityShimmerEnabled("idle", "online", false)).toBe(false);
    expect(activityShimmerEnabled("waiting-approval", "online", false)).toBe(false);
  });

  test("real conversation phase prevents shimmer on queued handoffs, approvals and finished turns", () => {
    const live: AssistantMessage = {
      id: "a", role: "assistant", text: "", at: 0, state: "streaming",
      turnId: "turn-1", seq: 0, status: "Thinking",
    };
    const highlighted = (message: AssistantMessage) =>
      activityShimmerEnabled(conversationThinking([message], "online").phase, "online", false);
    expect(highlighted(live)).toBe(true);
    expect(highlighted({ ...live, status: "Running terminal" })).toBe(true);
    expect(highlighted({ ...live, status: "", text: "new tokens" })).toBe(true);
    expect(highlighted({ ...live, handoff: "queued" })).toBe(false);
    expect(highlighted({ ...live, delivery: "queued" })).toBe(false);
    expect(highlighted({ ...live, status: "Waiting for approval" })).toBe(false);
    expect(highlighted({ ...live, state: "done" })).toBe(false);
    expect(highlighted({ ...live, state: "error" })).toBe(false);
  });

  test("gradient travels through bright glyph centers and rests fully off-glyph", () => {
    expect(SHIMMER_START).toBeLessThan(0);
    expect(SHIMMER_END).toBeGreaterThan(1);
    expect(SHIMMER_SWEEP_MS).toBeGreaterThan(0);
    expect(SHIMMER_REST_MS).toBeGreaterThan(0);
    expect(shimmerStops(SHIMMER_START)).toEqual([0, 0, 0, 0, 1]);
    expect(shimmerStops(0.5)[2]).toBe(0.5);
    expect(shimmerStops(0.5)[1]).toBeCloseTo(0.32);
    expect(shimmerStops(0.5)[3]).toBeCloseTo(0.68);
    expect(shimmerStops(SHIMMER_END)).toEqual([0, 1, 1, 1, 1]);
    for (let step = -40; step <= 140; step++) {
      const stops = shimmerStops(step / 100);
      for (const [index, stop] of stops.entries()) {
        expect(Number.isFinite(stop)).toBe(true);
        expect(stop).toBeGreaterThanOrEqual(0);
        expect(stop).toBeLessThanOrEqual(1);
        if (index > 0) {
          const previous = stops[index - 1];
          if (previous === undefined) throw new Error(`Missing shimmer stop at index ${index - 1}`);
          expect(stop).toBeGreaterThanOrEqual(previous);
        }
      }
    }
    expect(shimmerStops(Number.NaN)).toEqual(shimmerStops(SHIMMER_START));
    expect(shimmerStops(Number.POSITIVE_INFINITY)).toEqual(shimmerStops(SHIMMER_START));
  });

  test("Skia shades the actual Text glyphs and stops when reduced, blurred or unmounted", () => {
    const source = readFileSync(join(import.meta.dir, "../components/ShimmerText.tsx"), "utf8");
    expect(source).toContain("<SkText");
    expect(source).toContain("<LinearGradient");
    expect(source).toContain("colors={[dim, dim, bright, dim, dim]} positions={positions}");
    expect(source).toContain("useDerivedValue(() => shimmerStops(progress.value))");
    expect(source).toContain("cancelAnimation(progress)");
    expect(source).toContain("useAmbientRunning()");
    expect(source).toContain("useSyncExternalStore(subscribeAppActive, appIsActive, appIsActive)");
    expect(source).toContain('AppState.addEventListener("change"');
    expect(source).toContain("appListener?.remove()");
    expect(source).toContain("reduced || !running");
    expect(source).toContain("color: bright");
    expect(source).toContain("accessibilityLabel={text}");
    expect(source).toContain("Array.from(text)");
    expect(source).not.toContain("translateX");
  });

  test("the actual chat-list activity glyphs, not their container, own the shimmer", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    expect(pane).toContain("activityShimmerEnabled(thinking.phase, connectionStatus, stale)");
    expect(pane).toContain("<ShimmerText text={content.activity}");
    expect(pane).toContain("styles.rowActivityHighlight");
    expect(pane).toContain("content.needsAttention && styles.attention");
    expect(pane).toContain('maxWidth: "55%"');
  });
});
