import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AssistantMessage, Message, UserMessage } from "../model";
import {
  TranscriptFollowGate,
  sameTranscriptMessage,
  sameTranscriptRowProps,
  type TranscriptRowProps,
} from "./transcript-scroll-performance";

function prompt(id: string, text = "Inspect the change"): UserMessage {
  return { id, role: "user", at: 1, text };
}
function answer(id: string, text = "Completed"): AssistantMessage {
  return { id, role: "assistant", at: 2, text, state: "done", turnId: id, seq: 1 };
}
function props(message: Message, conversationId = "chat-1"): TranscriptRowProps {
  return { message, conversationId, harnessId: "hermes", detailMode: "Compact" };
}

test("20 settled transcript rows render only once over 240 scroll frames", () => {
  const rows: TranscriptRowProps[] = Array.from({ length: 20 }, (_, i) => props(
    i % 2 === 0 ? prompt(`u-${i}`) : answer(`a-${i}`),
  ));
  const rendered: TranscriptRowProps[] = [...rows];
  const renderCounts = rows.map(() => 1); // Initial React.memo render.
  const gate = new TranscriptFollowGate();
  const transitions: boolean[] = [];
  gate.beginDrag();

  for (let frame = 0; frame < 240; frame += 1) {
    const nextFollow = gate.observe({ contentHeight: 2800, viewportHeight: 700, offsetY: 10 + 5 * frame });
    if (nextFollow !== null) transitions.push(nextFollow);
    // Worst case: the parent creates fresh message objects on every scroll.
    // This is a render-decision harness for the production React.memo comparator;
    // it is not a mounted React Native/FlashList device benchmark.
    rows.forEach((previous, index) => {
      const candidate: TranscriptRowProps = { ...previous, message: { ...previous.message } };
      const last = rendered[index];
      if (last && !sameTranscriptRowProps(last, candidate)) {
        renderCounts[index] = (renderCounts[index] ?? 0) + 1;
        rendered[index] = candidate;
      }
    });
  }
  expect(renderCounts).toEqual(Array.from({ length: 20 }, () => 1));
  expect(transitions).toEqual([false]);
});

test("id alone never conceals changes to a settled message", () => {
  const completed = answer("a-1");
  expect(sameTranscriptMessage(completed, { ...completed })).toBe(true);
  expect(sameTranscriptMessage(completed, { ...completed, text: "New answer" })).toBe(false);
  expect(sameTranscriptMessage(completed, { ...completed, status: "Saved" })).toBe(false);
  expect(sameTranscriptMessage(completed, { ...completed, seq: 2 })).toBe(false);
  expect(sameTranscriptMessage(completed, { ...completed, state: "error" })).toBe(false);
  expect(sameTranscriptMessage(completed, { ...completed, activity: ["ran bun test"] })).toBe(false);
  expect(sameTranscriptMessage(completed, { ...completed, parts: [{ kind: "reasoning", text: "Thinking" }] })).toBe(false);
  expect(sameTranscriptMessage(completed, prompt("a-1"))).toBe(false);

  const uploaded: UserMessage = {
    ...prompt("u-attachment"),
    attachments: [{ id: "b".repeat(32), name: "clip.png", mime: "image/png", size: 42 }],
  };
  expect(sameTranscriptMessage(uploaded, { ...uploaded })).toBe(true);
  expect(sameTranscriptMessage(uploaded, { ...uploaded, attachments: [{ id: "b".repeat(32), name: "new.png", mime: "image/png", size: 42 }] })).toBe(false);
  expect(sameTranscriptMessage(uploaded, { ...uploaded, delivery: "failed" })).toBe(false);
  expect(sameTranscriptMessage(uploaded, { ...uploaded, deliveryNote: "Check before resend" })).toBe(false);
});

test("a current streaming row updates without waking older settled rows", () => {
  const previous = props(answer("old"));
  const active = props({ ...answer("live", ""), state: "streaming" });
  const activeThinking: TranscriptRowProps = { ...active, thinking: { phase: "thinking" } };
  expect(sameTranscriptRowProps(previous, { ...previous, message: { ...previous.message } })).toBe(true);
  expect(sameTranscriptRowProps(active, activeThinking)).toBe(false);
  expect(sameTranscriptRowProps(activeThinking, { ...activeThinking, thinking: { phase: "thinking" } })).toBe(true);
  expect(sameTranscriptRowProps(activeThinking, { ...activeThinking, thinking: { phase: "tool", tool: "terminal" } })).toBe(false);
  expect(sameTranscriptRowProps(active, { ...active, message: { ...active.message, text: "partial" } })).toBe(false);
  expect(sameTranscriptRowProps(previous, { ...previous, detailMode: "Full" })).toBe(false);
  expect(sameTranscriptRowProps(previous, { ...previous, harnessId: "omp" })).toBe(false);
  expect(sameTranscriptRowProps(previous, { ...previous, conversationId: "chat-2" })).toBe(false);
});

test("follow state publishes only boundary transitions at the existing 48px threshold", () => {
  const gate = new TranscriptFollowGate();
  const metrics = { contentHeight: 1200, viewportHeight: 600, offsetY: 0 };
  expect(gate.observe({ ...metrics, offsetY: 100 })).toBeNull(); // no user drag
  gate.beginDrag();
  expect(gate.observe({ ...metrics, offsetY: 101 })).toBeNull(); // same position
  expect(gate.observe({ ...metrics, offsetY: 200 })).toBe(false);
  expect(gate.observe({ ...metrics, offsetY: 400 })).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 550 })).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 552 })).toBe(true);
  expect(gate.observe({ ...metrics, offsetY: 560 })).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 550 })).toBe(false);
  gate.stopDrag();
  expect(gate.observe({ ...metrics, offsetY: 560 })).toBeNull(); // programmatic jump
  gate.setFollowing(true);
  gate.reset();
  expect(gate.observe({ ...metrics, offsetY: 250 })).toBeNull();
  gate.beginDrag();
  expect(gate.observe({ ...metrics, offsetY: 251 })).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 300 })).toBe(false);
});

test("web wheel, subpixel motion, content resizes and malformed metrics are bounded", () => {
  const gate = new TranscriptFollowGate();
  const metrics = { contentHeight: 1200, viewportHeight: 600, offsetY: 0 };
  expect(gate.observe({ ...metrics, offsetY: 0.7 }, true)).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 1.2 }, true)).toBe(false);
  expect(gate.observe({ ...metrics, offsetY: 1.8 }, true)).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 1.8, contentHeight: 2000 }, true)).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: Number.NaN }, true)).toBeNull();
  expect(gate.observe({ ...metrics, viewportHeight: Infinity, offsetY: 400 }, true)).toBeNull();
  expect(gate.observe({ ...metrics, offsetY: 554 }, true)).toBe(true);
});

test("memo comparator is wired to the actual row component; no scroll-time animations or timers", () => {
  const wrapper = readFileSync(new URL("../components/TranscriptRows.tsx", import.meta.url), "utf8");
  const controller = readFileSync(new URL("./transcript-scroll-performance.ts", import.meta.url), "utf8");
  expect(wrapper).toMatch(/memo\(function TranscriptRow/);
  expect(wrapper).toContain("}, sameTranscriptRowProps)");
  expect(wrapper).toMatch(/useCallback\(/);
  expect(controller).not.toMatch(/\b(?:LayoutAnimation|setInterval|setTimeout|withTiming|withSpring|requestAnimationFrame)\s*\(/);
});
