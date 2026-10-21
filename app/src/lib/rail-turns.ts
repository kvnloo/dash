import type { Message } from "../model";
import { splitThinking } from "./message-details";
import { fileRefs } from "./attachments";
import type { PromptAnchor } from "./prompt-navigation";

export type RailState = "done" | "needs-you" | "error" | "live";
export const railColors: Record<RailState, string> = { done: "#777777", "needs-you": "#E8B45D", error: "#F27979", live: "#7BB8F5" };
export interface RailTurn extends PromptAnchor {
  summary: string;
  characters: number;
  state: RailState;
  question: boolean;
  code: boolean;
  activityUpdates: number;
  files: string[];
  pr?: string;
}
/** Reading volume, not quality or importance. Fixed log scale: stable as chat grows. */
export function railWidth(characters: number): number {
  if (!Number.isFinite(characters) || characters <= 0) return 8;
  return 8 + 24 * Math.min(1, Math.log1p(characters) / Math.log1p(12000));
}
export function railState(messages: readonly Message[]): RailState {
  if (messages.some(m => m.role === "assistant" && m.state === "error")) return "error";
  if (messages.some(m => m.role === "assistant" && /waiting for (approval|clarification)|needs (your|owner) (input|decision)/i.test(m.status ?? ""))) return "needs-you";
  if (messages.some(m => m.role === "assistant" && m.state === "streaming")) return "live";
  return "done";
}
/** Weak keys avoid retaining old chats. No model calls, Markdown parse, or text subscription on scrub. */
export class RailSummaryCache {
  private readonly entries = new WeakMap<Message, string>();
  get(message: Message): string {
    const cached = this.entries.get(message);
    if (cached !== undefined) return cached;
    const answer = splitThinking(message.text).text;
    const summary = answer.split("\n").map(line => line.replace(/^\s*[#>*-]+\s*/, "").trim()).find(Boolean)?.slice(0, 200) ?? "No result text yet";
    this.entries.set(message, summary);
    return summary;
  }
}
const summaries = new RailSummaryCache();
export function railTurns(messages: readonly Message[]): RailTurn[] {
  const turns: RailTurn[] = [];
  for (let index = 0; index < messages.length; index++) {
    const prompt = messages[index];
    if (!prompt || prompt.role !== "user") continue;
    const replies: Message[] = [];
    let end = index + 1;
    while (end < messages.length && messages[end]?.role !== "user") {
      const reply = messages[end++];
      if (reply) replies.push(reply);
    }
    const answer = replies.filter(m => m.role === "assistant").map(m => splitThinking(m.text).text).join("\n");
    const last = replies.at(-1);
    turns.push({ id: prompt.id, index, text: prompt.text || "Attached files",
      summary: last ? summaries.get(last) : "No result text yet",
      characters: answer.length, state: railState(replies),
      question: /\?\s*$/.test(answer.trim()), code: /```(?:diff|patch)|^diff --git /m.test(answer),
      activityUpdates: replies.reduce((count, m) => count + (m.role === "assistant" ? m.activity?.length ?? (m.status ? 1 : 0) : 0), 0),
      files: fileRefs(answer), pr: answer.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0],
    });
    index = end - 1;
  }
  return turns;
}
