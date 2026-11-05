import { expect, test } from "bun:test";
import type { Z0LiveState } from "../../../shared/z0live-state";
import type { Message } from "../model";
import { HERO_ORB_SIZE, mergeVoicePhase, orbCaption, orbDotCount, orbFrame, orbMotion, orbPixels, transcriptTail, type OrbPhase } from "./orb-phase";

const PHASES: OrbPhase[] = ["idle", "thinking", "tool", "streaming", "waiting-approval", "listening", "speaking", "connecting"];
const range = (phase: OrbPhase) => {
  const m = orbMotion(phase);
  const scales = Array.from({ length: 201 }, (_, i) => orbFrame(m, i / 200).scale);
  return { min: Math.min(...scales), max: Math.max(...scales) };
};

test("chat phases keep their existing motion exactly", () => {
  expect(orbMotion("thinking")).toEqual({ animated: true, spin: 360, base: 0.96, amp: 0.04, beats: 2, wave: "cos", radiusX: 26, radiusY: 26, opacity: 1 });
  expect(orbMotion("tool")).toMatchObject({ animated: true, spin: -360, base: 0.96, amp: 0.04, beats: 2, radiusY: 26 });
  expect(orbMotion("streaming")).toMatchObject({ animated: true, spin: 720, radiusX: 26, radiusY: 18 });
  expect(orbMotion("idle")).toEqual({ animated: false, spin: 0, base: 1, amp: 0, beats: 0, wave: "cos", radiusX: 26, radiusY: 26, opacity: 0.55 });
  expect(orbMotion("waiting-approval")).toMatchObject({ animated: false, opacity: 1 });
  // Old worklet: rotate p*360, scale 0.96 + 0.04*cos(p*4π).
  for (const p of [0, 0.125, 0.3, 1]) expect(orbFrame(orbMotion("thinking"), p).scale).toBeCloseTo(0.96 + 0.04 * Math.cos(p * Math.PI * 4), 10);
  expect(orbFrame(orbMotion("tool"), 0.5).rotate).toBe(-180);
  expect(orbFrame(orbMotion("streaming"), 0.5).rotate).toBe(360);
});

test("listening breathes inward and tightens; speaking pulses outward and turns faster", () => {
  const listening = orbMotion("listening");
  const speaking = orbMotion("speaking");
  expect(listening.radiusX).toBeLessThan(26);
  expect(listening.radiusY).toBe(listening.radiusX);
  expect(range("listening").max).toBeLessThanOrEqual(1);
  expect(range("listening").min).toBeCloseTo(0.9, 5);
  expect(listening.beats).toBe(1);
  expect(Math.abs(listening.spin)).toBeLessThan(orbMotion("thinking").spin);
  expect(range("speaking").min).toBe(1);
  expect(range("speaking").max).toBeCloseTo(1.07, 2);
  expect(speaking.beats).toBeGreaterThan(orbMotion("thinking").beats);
  expect(speaking.spin).toBeGreaterThan(orbMotion("thinking").spin);
  expect(orbFrame(speaking, 1 / 16).scale).toBeCloseTo(1.07, 5);
  expect(orbMotion("connecting")).toMatchObject({ animated: true, spin: 180, opacity: 0.75, radiusX: 24 });
  expect(range("connecting").max).toBeLessThan(1);
  for (const phase of PHASES) expect(orbFrame(orbMotion(phase), 0)).toMatchObject({ scale: orbMotion(phase).base + orbMotion(phase).amp * (orbMotion(phase).wave === "abs" ? 0 : 1) });
});

test("hero size is denser and ~220 px", () => {
  expect(orbPixels("hero")).toBe(220);
  expect(HERO_ORB_SIZE).toBeGreaterThanOrEqual(200);
  expect(HERO_ORB_SIZE).toBeLessThanOrEqual(240);
  expect(orbPixels(48)).toBe(48);
  expect([orbDotCount(20), orbDotCount(21), orbDotCount(159), orbDotCount(160), orbDotCount("hero")]).toEqual([32, 96, 96, 160, 160]);
});

const call: Extract<Z0LiveState, { live: true }> = { live: true, sessionId: "s", phase: "tool", tool: "ask_z0", muted: false, updated: 1, transcript: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }] };

test("a live z0live call owns the orb; otherwise the chat phase shows", () => {
  expect(mergeVoicePhase(call, { phase: "streaming" })).toEqual({ phase: "tool", tool: "ask_z0", source: "z0live" });
  expect(mergeVoicePhase({ ...call, phase: "speaking" }, { phase: "tool", tool: "terminal" })).toEqual({ phase: "speaking", source: "z0live" });
  expect(mergeVoicePhase({ live: false }, { phase: "tool", tool: "terminal" })).toEqual({ phase: "tool", tool: "terminal", source: "chat" });
  expect(mergeVoicePhase(undefined, { phase: "idle" })).toEqual({ phase: "idle", source: "chat" });
});

test("captions name the tool or the voice step", () => {
  expect(orbCaption({ phase: "tool", tool: "ask_z0" }, "idle")).toBe("working · ask_z0");
  expect(orbCaption({ phase: "tool" }, "idle")).toBe("working");
  expect(orbCaption({ phase: "waiting-approval" }, "idle")).toBe("waiting for approval or clarification");
  expect(["listening", "speaking", "connecting"].map(phase => orbCaption({ phase: phase === "listening" ? "listening" : phase === "speaking" ? "speaking" : "connecting" }, "x"))).toEqual(["listening", "speaking", "connecting"]);
  expect(orbCaption({ phase: "idle" }, "offline")).toBe("offline");
  expect(orbCaption({ phase: "thinking" }, "idle")).toBe("working");
  expect(orbCaption({ phase: "streaming" }, "idle")).toBe("working");
});

test("transcript tail: the call's lines when live, else the chat's last non-empty lines", () => {
  const msgs: Message[] = [
    { id: "1", role: "user", text: "one", at: 1 },
    { id: "2", role: "assistant", text: "two\n  lines", at: 2, state: "done", turnId: "t1", seq: 1 },
    { id: "3", role: "user", text: "  ", at: 3 },
    { id: "4", role: "user", text: "y".repeat(300), at: 4 },
  ];
  expect(transcriptTail(call, msgs)).toEqual(call.transcript);
  expect(transcriptTail({ ...call, transcript: [...call.transcript, { role: "user", text: "c" }] }, msgs, 2)).toEqual([{ role: "assistant", text: "b" }, { role: "user", text: "c" }]);
  expect(transcriptTail({ live: false }, msgs)).toEqual([{ role: "user", text: "one" }, { role: "assistant", text: "two lines" }, { role: "user", text: `${"y".repeat(279)}…` }]);
  expect(transcriptTail(undefined, msgs, 1)).toHaveLength(1);
  expect(transcriptTail(undefined, [])).toEqual([]);
});
