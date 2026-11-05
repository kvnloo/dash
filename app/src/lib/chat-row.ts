import type { ConnectionStatus, Conversation } from "../model";
import { chatAttention } from "./chat-attention";
import { conversationThinking } from "./thinking";

/** Literal excerpt only: no generated summary, markdown interpretation or inferred outcome. */
function firstSentence(text: string): string {
  const line = text.split("\n").find(value => value.trim())?.trim() ?? "";
  const end = /[.!?](?=\s|$)/.exec(line);
  return (end ? line.slice(0, end.index + 1) : line).replace(/\s+/g, " ");
}

function rowActivity(chat: Conversation, connection: ConnectionStatus): string {
  if (chat.stale) return "Ended";
  if (connection !== "online") return `Activity unknown · ${connection === "idle" ? "disconnected" : connection}`;
  const latest = chat.messages.findLast(message => message.role === "assistant");
  if (latest?.role === "assistant" && (latest.state === "pending" || latest.state === "streaming") && latest.handoff) {
    return latest.handoff === "queued" ? "Waiting for host" : "Sending to host";
  }
  const thinking = conversationThinking(chat.messages, connection);
  if (thinking.phase !== "idle") {
    const running = chat.messages.findLast(message => message.role === "assistant" && message.state === "streaming" && message.delivery !== "queued" && message.delivery !== "steered" && !message.handoff);
    if (running?.role === "assistant" && running.status?.trim()) return running.status.replace(/\s+/g, " ").trim();
    return thinking.phase === "streaming" ? "Running · replying" : "Running · thinking";
  }
  if (latest?.role === "assistant" && (latest.state === "pending" || latest.state === "streaming")) {
    if (latest.delivery === "queued" || latest.delivery === "steered") return "Queued";
    return "Waiting to start";
  }
  if (chatAttention(chat) === "Needs attention") return "Needs attention";
  return chat.openIn ? `Open in ${chat.openIn}` : "No active turn";
}

/** Uses only the conversation fields already supplied to the phone. cwd is not a git root. */
export function chatRow(chat: Conversation, harnessName: string, connection: ConnectionStatus) {
  let outcome = "";
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    const message = chat.messages[i];
    if (message?.role !== "assistant" || message.state !== "done") continue;
    outcome = firstSentence(message.text);
    if (outcome) break;
  }
  const cwd = chat.cwd?.trim();
  const folderName = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  const activity = rowActivity(chat, connection);
  return {
    title: chat.title.trim() || harnessName,
    folder: folderName ? `Folder · ${folderName}` : "Folder unknown",
    folderPath: cwd || undefined,
    outcome: outcome || "No summary yet",
    outcomeLabel: outcome ? "Last reply" : null,
    activity,
    needsAttention: activity === "Needs attention",
  };
}
