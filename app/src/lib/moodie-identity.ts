import type { AgentInfo } from "../../../shared/protocol";
import type { Message } from "../model";
import type { ExpressionName } from "../vendor/moodie";
import { conversationThinking } from "./thinking";

export type BotFaceState = "idle" | "thinking" | "working" | "done" | "error" | "waiting-approval";
export interface BotFaceIdentity { key: string; rest: ExpressionName; offset: number }

/** Only explicit profile metadata or a profile agent id identifies a Hermes profile. */
export function hermesProfileKey(agent: Pick<AgentInfo, "id" | "kind" | "profileId">): string | undefined {
  if (agent.kind !== "hermes") return undefined;
  if (agent.profileId?.trim()) return agent.profileId.trim();
  if (agent.id === "hermes") return "default";
  if (agent.id.startsWith("hermes:") && !agent.id.startsWith("hermes:session:")) return agent.id.slice(7).trim() || undefined;
  return undefined;
}

const REST_EXPRESSIONS: readonly ExpressionName[] = ["neutral", "curious", "calm", "cheeky", "shy", "proud", "wink"];

/** Familiar profiles keep distinct silhouettes even in monochrome. Other identities are seeded. */
const HERMES_REST: Record<string, ExpressionName> = { default: "neutral", clean: "curious", chiefstaff: "calm", intake: "cheeky" };
/** FNV-1a over the canonical identity, not hostname, session id or display label. */
export function botFaceIdentity(profile: string, runtime = "hermes"): BotFaceIdentity {
  const key = `${runtime}:${profile.trim() || "default"}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  const namedRest = runtime === "hermes" && Object.hasOwn(HERMES_REST, profile.trim() || "default") ? HERMES_REST[profile.trim() || "default"] : undefined;
  return { key, rest: namedRest ?? REST_EXPRESSIONS[hash % REST_EXPRESSIONS.length] ?? "neutral", offset: (hash % 1000) / 100 };
}

export function expressionForState(state: BotFaceState, rest: ExpressionName): ExpressionName {
  switch (state) {
    case "idle": return rest;
    case "thinking": return "thinking";
    case "working": return "focused";
    case "done": return "happy";
    case "error": return "worried";
    case "waiting-approval": return "alert";
  }
}

/** A running gateway is not proof of an in-flight turn. Offline faces stay at rest. */
export function faceStateFromMessages(messages: Message[], online = true): BotFaceState {
  if (!online) return "idle";
  const phase = conversationThinking(messages).phase;
  if (phase === "thinking" || phase === "waiting-approval") return phase;
  if (phase === "tool" || phase === "streaming") return "working";
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && (last.state === "done" || last.state === "error")) return last.state;
  return "idle";
}
