import type { Message } from "../model";
import { splitThinking } from "./message-details";
import { fileRefs } from "./attachments";
import type { PromptAnchor } from "./prompt-navigation";

export type RailState = "done" | "needs-you" | "error" | "live";
export const railColors: Record<RailState, string> = { done: "#777777", "needs-you": "#E8B45D", error: "#F27979", live: "#7BB8F5" };
export interface RailTurn extends PromptAnchor {
  summary: string;
  characters: number;
  durationMs: number;
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
/** Worst state first: a bar that stands for several prompts must not hide an error or a waiting one. */
const railPrecedence: readonly RailState[] = ["error", "needs-you", "live", "done"];
/** One drawn bar: a prompt, or the run of prompts too close together to draw apart. */
export interface RailBin { key: string; top: number; width: number; state: RailState; change: boolean; question: boolean }
/**
 * Fit the rail to its height. Prompts at least `pitch` apart get a bar each; a longer chat folds the
 * prompts closer than that into one bar (widest width, worst state, any diff or question mark), so a
 * 1000-message chat is still one readable column and the bar count is bounded by the rail's height.
 */
export function railBins(anchors: readonly RailTurn[], positions: readonly number[], pitch = 2): RailBin[] {
  const bins: RailBin[] = [];
  let origin = -Infinity;
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index];
    if (!anchor) continue;
    const top = positions[index] ?? 0;
    const width = railWidth(anchor.characters);
    const change = Boolean(anchor.code || anchor.pr);
    const bin = bins[bins.length - 1];
    if (bin && top - origin < pitch) {
      bin.width = Math.max(bin.width, width);
      if (railPrecedence.indexOf(anchor.state) < railPrecedence.indexOf(bin.state)) bin.state = anchor.state;
      bin.change ||= change;
      bin.question ||= anchor.question;
      continue;
    }
    origin = top;
    bins.push({ key: anchor.id, top, width, state: anchor.state, change, question: anchor.question });
  }
  return bins;
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
    if (message.role === "assistant" && message.state === "error") {
      const failure = message.error?.trim().slice(0, 200) || "Turn failed; open transcript for details";
      this.entries.set(message, failure);
      return failure;
    }
    const answer = splitThinking(message.text).text;
    const summary = answer.split("\n").map(line => line.replace(/^\s*[#>*-]+\s*/, "").trim()).find(Boolean)?.slice(0, 200) ?? "No result text yet";
    this.entries.set(message, summary);
    return summary;
  }
}
const summaries = new RailSummaryCache();
/**
 * A settled turn depends only on its prompt, its replies and the prompt after it, all immutable, so
 * it is computed once. A chat of 2000 rows then costs one pass of identity checks per update, not a
 * pass over every message's text (the open turn changes with each streamed token).
 */
interface TurnMemo { replies: readonly Message[]; next: number | undefined; turn: RailTurn }
const settledTurns = new WeakMap<Message, TurnMemo>();
export function railTurns(messages: readonly Message[], now = Date.now()): RailTurn[] {
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
    const nextPrompt = messages[end];
    const next = nextPrompt?.role === "user" ? nextPrompt.at : undefined;
    const memo = settledTurns.get(prompt);
    if (memo && memo.next === next && memo.replies.length === replies.length && memo.replies.every((reply, at) => reply === replies[at])) {
      turns.push(memo.turn.index === index ? memo.turn : { ...memo.turn, index });
      index = end - 1;
      continue;
    }
    const answer = replies.filter(m => m.role === "assistant").map(m => splitThinking(m.text).text).join("\n");
    const last = replies.find(m => m.role === "assistant" && m.state === "error") ?? replies.at(-1);
    const assistants = replies.filter(m => m.role === "assistant");
    const running = assistants.some(m => m.state === "streaming" || m.state === "pending");
    let ended = running ? now : Math.max(prompt.at, ...assistants.map(m => m.endedAt ?? m.at));
    if (!running && !assistants.some(m => m.endedAt !== undefined) && ended - prompt.at < 1000 && next !== undefined) ended = next;
    const durationMs = Math.max(0, ended - prompt.at);
    const turn: RailTurn = { id: prompt.id, index, text: prompt.text || "Attached files",
      summary: last ? summaries.get(last) : "No result text yet",
      characters: answer.length, durationMs, state: railState(replies),
      question: /\?\s*$/.test(answer.trim()), code: /```(?:diff|patch)|^diff --git /m.test(answer),
      activityUpdates: replies.reduce((count, m) => count + (m.role === "assistant" ? m.activity?.length ?? (m.status ? 1 : 0) : 0), 0),
      files: fileRefs(answer), pr: answer.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0],
    };
    turns.push(turn);
    if (!running) settledTurns.set(prompt, { replies, next, turn });
    index = end - 1;
  }
  return turns;
}
