import type { Thinking } from "./thinking";

export type SendMode = "steer" | "queue";
export function canSteer(harness: string, sessionId: string | undefined, phase: Thinking["phase"], liveSurface = false): boolean {
  return harness === "hermes" && Boolean(sessionId) && !liveSurface && ["thinking", "tool", "streaming"].includes(phase);
}
export function composerMode(busy: boolean, choice: SendMode = "steer"): { mode: SendMode; label: string; action: string } {
  return !busy ? { mode: "queue", label: "", action: "Send" }
    : choice === "steer" ? { mode: "steer", label: "Steer the running turn", action: "Steer" }
    : { mode: "queue", label: "Queue for next turn", action: "Queue" };
}
