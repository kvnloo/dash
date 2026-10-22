import type { Conversation } from "../model";
import { allowedModel, type RecentModel } from "../../../shared/recent-models";

export function hermesProfileFor(conversation: Pick<Conversation, "harness" | "profileId" | "profileName"> | undefined): string | undefined {
  if (!conversation || conversation.harness !== "hermes") return undefined;
  const valid = (value: string | undefined) => value && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ? value : undefined;
  if (conversation.profileName) return valid(conversation.profileName);
  const match = conversation.profileId?.match(/^hermes:session:([^:]+):/);
  if (match) {
    try { return valid(decodeURIComponent(match[1] ?? "")); } catch { return undefined; }
  }
  return conversation.profileId === "hermes:default" ? "default" : valid(conversation.profileId);
}
/** A displayable native command, not a chat prompt or authorization to execute it. */
export function sessionModelCommand(model: RecentModel): string | undefined {
  return allowedModel(model.provider, model.model) ? `/model ${model.model} --provider ${model.provider} --session` : undefined;
}
