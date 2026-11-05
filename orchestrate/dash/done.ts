/** Machine-checkable "is Dash done?" bar. Open slices are the next TDD picks. */

export type SliceState = "open" | "done" | "blocked";

export type Slice = {
  id: string;
  state: SliceState;
  issue?: number;
  blockedBy?: string;
};

export const SUBAGENT_EFFORT = "low";
export const SUBAGENT_MODELS = ["cursor-grok-4.6-low", "cursor-grok-4.6-low-fast"] as const;

export const DASH_DONE_SLICES: Slice[] = [
  { id: "oss-loop", state: "done" },
  { id: "install-slim", state: "done" },
  { id: "attach-flush", state: "done" },
  { id: "offline-send", state: "done", issue: 3 },
  { id: "no-demo-bots", state: "blocked", blockedBy: "claimed:#8" },
  { id: "hermes-a2a", state: "blocked", blockedBy: "claimed:#9" },
  { id: "aodl-orchestra", state: "blocked", blockedBy: "claimed:#19" },
  { id: "live-chats", state: "blocked", blockedBy: "claimed:#20" },
  { id: "visual-json", state: "blocked", blockedBy: "claimed:#21" },
  { id: "live-transcript", state: "blocked", blockedBy: "claimed:#26" },
  { id: "thinking-orbs", state: "blocked", blockedBy: "claimed:#27" },
  { id: "live-slash", state: "blocked", blockedBy: "claimed:#28" },
  { id: "self-dev-home", state: "blocked", blockedBy: "claimed:#29" },
  { id: "mesh-discover", state: "blocked", blockedBy: "needs-discussion:#5" },
];

export function nextOpenSlice(slices: readonly Slice[] = DASH_DONE_SLICES): Slice | undefined {
  return slices.find((slice) => slice.state === "open");
}

export function shouldKeepGoing(slices: readonly Slice[] = DASH_DONE_SLICES): boolean {
  return nextOpenSlice(slices) !== undefined;
}
