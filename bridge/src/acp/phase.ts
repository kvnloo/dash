import { TurnPhase } from "../turn-phase";

/** ACP updates can omit title on completion. Keep identity until that tool settles. */
export function acpToolPhase(phase: TurnPhase, update: Record<string, unknown>): void {
  const id = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
  const name = typeof update.title === "string" ? update.title : "tool";
  if (update.status === "completed" || update.status === "failed") phase.complete(id);
  else if (update.status === "waiting_for_approval") phase.waiting();
  else phase.start(name, id);
}
