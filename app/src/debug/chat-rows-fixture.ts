import type { AssistantMessage, Conversation } from "../model";

/** Deterministic, debug-only row cases. No bridge reads or generated summaries. */
export function chatRowsFixture(now = Date.now()): Conversation[] {
  const reply = (text: string): AssistantMessage => ({ id: "reply", role: "assistant", text, state: "done", at: now - 60_000, turnId: "fixture-turn", seq: 0 });
  const base = { harness: "hermes", createdAt: now - 600_000, updatedAt: now - 60_000 };
  return [
    { ...base, id: "row-running", title: "Check the retry path", cwd: "/workspace/dash", messages: [reply("The error now stays visible. The retry check is next."), { ...reply(""), id: "working", turnId: "working-turn", state: "streaming", status: "Running tests" }] },
    { ...base, id: "row-rich", title: "Repair pairing feedback", cwd: "/workspace/dash", messages: [reply("Pairing now keeps errors visible. The retry test passes.")] },
    { ...base, id: "row-repoless", title: "Plan the garden review", messages: [reply("The review notes are saved. Photos are still needed.")] },
    { ...base, id: "row-empty", title: "Inspect the next handoff", cwd: "/workspace/ripple", messages: [{ id: "ask", role: "user", text: "Check this handoff", at: now - 60_000 }] },
  ];
}
