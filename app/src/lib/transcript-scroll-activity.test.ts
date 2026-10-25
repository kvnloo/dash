import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Message } from "../model";
import { sameTranscriptRowProps, type TranscriptRowProps } from "./transcript-scroll-performance";
import { TranscriptScrollActivity } from "./transcript-scroll-activity";

function settledRow(index: number): TranscriptRowProps {
  const message: Message = index % 2 === 0
    ? { id: `user-${index}`, role: "user", at: index, text: "Question" }
    : { id: `assistant-${index}`, role: "assistant", at: index, text: "Answer",
        state: "done", turnId: `turn-${index}`, seq: 1 };
  return { conversationId: "chat", message, harnessId: "hermes", detailMode: "Compact" };
}

describe("transcript scroll frame isolation", () => {
  test("240 native scroll frames notify the shimmer only on entry/exit; 20 settled rows render once", () => {
    const activity = new TranscriptScrollActivity();
    const rows = Array.from({ length: 20 }, (_, index) => settledRow(index));
    const rendered = [...rows];
    const rowRenderCount = rows.map(() => 1);
    let shimmerRenderCount = 1;
    const snapshots: boolean[] = [];
    const unsubscribe = activity.subscribe(() => {
      shimmerRenderCount += 1;
      snapshots.push(activity.getSnapshot());
    });

    activity.begin("window-chat");
    for (let frame = 0; frame < 240; frame += 1) {
      // Even a mistakenly duplicated drag/momentum begin cannot publish a frame.
      activity.begin("window-chat");
      for (let i = 0; i < rows.length; i += 1) {
        const previous = rendered[i];
        const row = rows[i];
        if (!previous || !row) throw new Error("missing render probe row");
        // Pessimistic parent recreates every row object for every scroll frame.
        const next: TranscriptRowProps = { ...row, message: { ...row.message } };
        if (!sameTranscriptRowProps(previous, next)) {
          rowRenderCount[i] = (rowRenderCount[i] ?? 0) + 1;
          rendered[i] = next;
        }
      }
    }
    activity.end("window-chat");
    activity.end("window-chat"); // momentum-end and unmount may both release
    unsubscribe();

    // Decision harness for actual React.memo comparator and external-store
    // notifications, not a mounted Fabric/FlashList or hardware benchmark.
    expect(rowRenderCount).toEqual(Array.from({ length: 20 }, () => 1));
    expect(shimmerRenderCount).toBe(3); // initial + start + end
    expect(snapshots).toEqual([true, false]);
  });

  test("duplicate and overlapping scopes publish only zero-to-one transitions", () => {
    const activity = new TranscriptScrollActivity();
    const history: boolean[] = [];
    const unmount = activity.subscribe(() => history.push(activity.getSnapshot()));
    expect(activity.getServerSnapshot()).toBe(false);
    expect(activity.getSnapshot()).toBe(false);
    activity.begin("");
    activity.begin("chat-A");
    activity.begin("chat-A");
    activity.begin("chat-B");
    activity.end("chat-A");
    expect(activity.getSnapshot()).toBe(true);
    activity.end("chat-B");
    activity.end("missing");
    expect(history).toEqual([true, false]);
    unmount();
    activity.begin("chat-C");
    activity.end("chat-C");
    expect(history).toEqual([true, false]); // no leaked listener
  });

  test("a real settled-row change still invalidates the memo guard", () => {
    const before = settledRow(1);
    expect(sameTranscriptRowProps(before, { ...before, message: { ...before.message } })).toBe(true);
    expect(sameTranscriptRowProps(before, { ...before, message: { ...before.message, text: "Updated answer" } })).toBe(false);
  });

  test("ShimmerText subscribes to scroll phase; retains the same painted glyphs when paused", () => {
    const source = readFileSync(new URL("../components/ShimmerText.tsx", import.meta.url), "utf8");
    expect(source).toContain("transcriptScrollActivity.subscribe");
    expect(source).toContain("transcriptScrollActivity.getSnapshot");
    expect(source).toContain("const running = paintActive && !scrolling;");
    expect(source).toContain("if (!font || reduced || !paintActive)");
    expect(source).toContain("cancelAnimation(progress)");
    expect(source).toContain("const positions = useDerivedValue(() => shimmerStops(progress.value))");
    expect(source).toContain("<SkText");
    expect(source).toContain("colors={[dim, dim, bright, dim, dim]} positions={positions}");
    expect(source).toContain("setMax(previous => previous === width ? previous : width)");
    // A gesture must freeze the current Skia shader, not restart its colour band
    // on each scroll transition or render a visually different text fallback.
    expect(source).not.toContain("progress.value = SHIMMER_START;");
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});
