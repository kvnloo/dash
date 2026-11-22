import type { ConnectionStatus, Conversation } from "../model";
import { chatAttention } from "./chat-attention";
import { chatPreview, currentChatTask } from "./chat-preview";
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

/** Prefer a verified repo root; never relabel an unverified folder as a repository. */
export function rowWorkspace(cwd?: string, repoRoot?: string) {
  const path = repoRoot?.trim() || cwd?.trim();
  const name = path?.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return {
    folder: name ? `${repoRoot ? "Repo" : "Folder"} · ${name}` : "Folder unknown",
    folderPath: path || undefined,
    isRepo: Boolean(repoRoot),
  };
}

export function chatRow(chat: Conversation, harnessName: string, connection: ConnectionStatus) {
  const preview = chatPreview(chat);
  const task = currentChatTask(chat);
  const activity = rowActivity(chat, connection);
  // Do not bury delivery failures or input requests beneath an older task.
  const urgent = preview.kind === "failed" || preview.kind === "needs-you";
  const outcome = urgent ? preview.text : task || (preview.kind === "working" ? preview.text :
    chat.messageCount || chat.messages.length ? "No task summary available" : "No summary yet");
  return {
    title: chat.title.trim() || harnessName,
    ...rowWorkspace(chat.cwd, chat.repoRoot),
    outcome,
    outcomeLabel: !urgent && task ? "Task" : null,
    activity,
    needsAttention: activity === "Needs attention",
  };
}
