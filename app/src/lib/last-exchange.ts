// #507: the main bar stays attached to one agent; show the last message or two from that chat so
// the owner knows what they are replying to without opening it. Pure.
import type { Conversation } from "../model";

export interface LastExchange { you?: string; agent?: string; replying: boolean }
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
};

export function lastExchange(conversation: Pick<Conversation, "messages" | "preview">, max = 140): LastExchange {
  let you: string | undefined, agent: string | undefined, replying = false;
  for (let i = conversation.messages.length - 1; i >= 0 && (you === undefined || agent === undefined); i--) {
    const m = conversation.messages[i]!;
    if (m.role === "assistant") {
      if (agent !== undefined || you !== undefined) continue;
      if (m.state === "streaming" || m.state === "pending") { replying = true; continue; }
      if (m.text.trim()) agent = clip(m.text, max);
    } else if (you === undefined && m.text.trim()) you = clip(m.text, max);
  }
  // Transcript not loaded yet: the light index keeps a one-line preview of the latest message.
  if (you === undefined && agent === undefined && !replying && conversation.preview?.trim()) agent = clip(conversation.preview, max);
  return { ...(you !== undefined ? { you } : {}), ...(agent !== undefined ? { agent } : {}), replying };
}
