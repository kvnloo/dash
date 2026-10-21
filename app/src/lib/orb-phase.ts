import type { Z0LiveLine, Z0LiveState } from "../../../shared/z0live-state";
import type { Message } from "../model";
import type { Thinking, ThinkingPhase } from "./thinking";

/** Chat phases plus the live voice call's. One orb vocabulary for chat, lists and voice. */
export type OrbPhase = ThinkingPhase | "listening" | "speaking" | "connecting";
export type OrbState = { phase: OrbPhase; tool?: string };
export type OrbSize = number | "hero";

export const HERO_ORB_SIZE = 220;
export function orbPixels(size: OrbSize): number { return size === "hero" ? HERO_ORB_SIZE : size; }
/** Denser silhouette as the orb grows; tiny badges keep a cheap 32. */
export function orbDotCount(size: OrbSize): number {
  const px = orbPixels(size);
  return px <= 20 ? 32 : px >= 160 ? 160 : 96;
}

/**
 * Per-phase motion, all driven by the one shared 0..1 clock (see OrbMotion).
 * scale(p) = base + amp * wave(p): "cos" breathes around base, "abs" pulses outward from base.
 * radiusX/radiusY are the dot sphere's radii in the 64-unit viewBox (26 = full).
 */
export type OrbMotionParams = { animated: boolean; spin: number; base: number; amp: number; beats: number; wave: "cos" | "abs"; radiusX: number; radiusY: number; opacity: number };

const STILL: Omit<OrbMotionParams, "animated" | "opacity"> = { spin: 0, base: 1, amp: 0, beats: 0, wave: "cos", radiusX: 26, radiusY: 26 };
export function orbMotion(phase: OrbPhase): OrbMotionParams {
  switch (phase) {
    case "idle": return { ...STILL, animated: false, opacity: 0.55 };
    case "waiting-approval": return { ...STILL, animated: false, opacity: 1 };
    case "thinking": return { animated: true, spin: 360, base: 0.96, amp: 0.04, beats: 2, wave: "cos", radiusX: 26, radiusY: 26, opacity: 1 };
    case "tool": return { animated: true, spin: -360, base: 0.96, amp: 0.04, beats: 2, wave: "cos", radiusX: 26, radiusY: 26, opacity: 1 };
    case "streaming": return { animated: true, spin: 720, base: 0.96, amp: 0.04, beats: 2, wave: "cos", radiusX: 26, radiusY: 18, opacity: 1 };
    // Slow inward breathe: always at or below rest size, dots drawn slightly tighter.
    case "listening": return { animated: true, spin: 90, base: 0.93, amp: 0.03, beats: 1, wave: "cos", radiusX: 23, radiusY: 23, opacity: 1 };
    // Outward pulse rhythm, faster turn.
    case "speaking": return { animated: true, spin: 540, base: 1, amp: 0.07, beats: 8, wave: "abs", radiusX: 26, radiusY: 26, opacity: 1 };
    case "connecting": return { animated: true, spin: 180, base: 0.9, amp: 0.05, beats: 1, wave: "cos", radiusX: 24, radiusY: 24, opacity: 0.75 };
  }
}

/** Pure sample of the orb's transform at clock position p; the worklet mirrors this arithmetic. */
export function orbFrame(m: OrbMotionParams, p: number): { rotate: number; scale: number } {
  const wave = m.wave === "abs" ? Math.abs(Math.sin(p * Math.PI * m.beats)) : Math.cos(p * Math.PI * 2 * m.beats);
  return { rotate: p * m.spin, scale: m.base + m.amp * wave };
}

/** A live z0live call owns the orb; otherwise it mirrors the chat's live thinking. */
export function mergeVoicePhase(call: Z0LiveState | undefined, chat: Thinking): OrbState & { source: "z0live" | "chat" } {
  if (call?.live) return { phase: call.phase, ...(call.phase === "tool" && call.tool ? { tool: call.tool } : {}), source: "z0live" };
  return { ...chat, source: "chat" };
}

export function orbCaption(state: OrbState, idle: string): string {
  switch (state.phase) {
    case "tool": return state.tool ? `working · ${state.tool}` : "working";
    case "waiting-approval": return "waiting for approval or clarification";
    case "listening": return "listening";
    case "speaking": return "speaking";
    case "connecting": return "connecting";
    case "idle": return idle;
    default: return "working";
  }
}

/** The last few spoken/typed lines: the live call's when one is live, else the chat's. */
export function transcriptTail(call: Z0LiveState | undefined, messages: readonly Message[], count = 3): Z0LiveLine[] {
  if (call?.live) return call.transcript.slice(-count);
  const lines: Z0LiveLine[] = [];
  for (let i = messages.length - 1; i >= 0 && lines.length < count; i -= 1) {
    const m = messages[i];
    const text = m?.text.replace(/\s+/g, " ").trim();
    if (m && text) lines.unshift({ role: m.role, text: text.length > 280 ? `${text.slice(0, 279)}…` : text });
  }
  return lines;
}
