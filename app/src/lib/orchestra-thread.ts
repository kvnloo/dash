import { conversationStreaming } from "../catalog/runtime-state";
import type { OrchestraProject } from "../catalog/orchestra";
import type { Conversation } from "../model";

export type OrchestraThreadTarget =
  | { kind: "chat"; conversationId: string }
  | { kind: "detail"; orchestraId: string };

export type AgentThreadTarget =
  | { kind: "chat"; conversationId: string }
  | { kind: "create"; harnessId: string };

function isLive(conversation: Conversation): boolean {
  return Boolean(conversation.sessionId) || conversationStreaming(conversation.messages);
}

function newestLiveFirst(a: Conversation, b: Conversation): number {
  const live = Number(isLive(b)) - Number(isLive(a));
  if (live !== 0) return live;
  return b.updatedAt - a.updatedAt;
}

export function threadTargetForOrchestra(
  project: Pick<OrchestraProject, "id" | "chatIds" | "agents">,
  conversations: Conversation[],
): OrchestraThreadTarget {
  const linked = conversations.filter(
    (c) => project.chatIds.includes(c.id) || project.agents.includes(c.harness),
  );
  const top = [...linked].sort(newestLiveFirst)[0];
  if (!top) return { kind: "detail", orchestraId: project.id };
  return { kind: "chat", conversationId: top.id };
}

export function threadTargetForAgent(harnessId: string, conversations: Conversation[]): AgentThreadTarget {
  const top = conversations.filter((c) => c.harness === harnessId).sort(newestLiveFirst)[0];
  if (!top) return { kind: "create", harnessId };
  return { kind: "chat", conversationId: top.id };
}
