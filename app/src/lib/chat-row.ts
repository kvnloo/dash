import type { ConnectionStatus, Conversation } from "../model";
import { chatAttention } from "./chat-attention";
import { chatPreview } from "./chat-preview";
import { conversationThinking } from "./thinking";

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
  const preview = chatPreview(chat);
  // Nothing said yet and no bridge excerpt: the preview would only repeat the title or folder.
  const blank = preview.kind === "empty" && !chat.preview?.trim();
  const cwd = chat.cwd?.trim();
  const folderName = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  const activity = rowActivity(chat, connection);
  return {
    title: chat.title.trim() || harnessName,
    folder: folderName ? `Folder · ${folderName}` : "Folder unknown",
    folderPath: cwd || undefined,
    outcome: blank ? "No summary yet" : preview.text,
    outcomeLabel: preview.kind === "reply" ? "Last reply" : null,
    activity,
    needsAttention: activity === "Needs attention",
  };
}
