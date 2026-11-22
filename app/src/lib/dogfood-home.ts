import type { Conversation, Settings } from "../model";
import { FEEDBACK_CONVERSATION_ID, inAppFeedbackEnabled } from "./feedback";

/**
 * Dogfood home: the self-development loop is the view Dash opens on (dash#29, ledger DA-051).
 * The owner types or dictates what is off, it goes to the Dash secondmate as feedback, and the
 * fix comes back through the turbo preview. It is the cold-open view while in-app feedback is on
 * (the beta default); turning feedback off in Settings restores the plain Main tabs.
 */
export function opensOnDogfood(settings: Settings | null, opts: { debug: boolean; routeTab: unknown }): boolean {
  if (opts.debug || typeof opts.routeTab === "number") return false;
  return settings !== null && inAppFeedbackEnabled(settings);
}

/** The feedback thread for this bridge (createConversation scopes the id per endpoint on reuse). */
export function isFeedbackConversation(conversation: Pick<Conversation, "id">): boolean {
  return conversation.id === FEEDBACK_CONVERSATION_ID || conversation.id.startsWith(FEEDBACK_CONVERSATION_ID + ":endpoint:");
}

export function feedbackConversation(conversations: readonly Conversation[], address: string | undefined): Conversation | undefined {
  return conversations.find(c => isFeedbackConversation(c) && c.endpointAddress === address);
}

export type FeedbackLoopStatus = "unsent" | "sent" | "working" | "answered" | "failed";

export interface FeedbackLoopItem {
  id: string;
  text: string;
  at: number;
  status: FeedbackLoopStatus;
}

export const FEEDBACK_STATUS_LABEL: Record<FeedbackLoopStatus, string> = {
  unsent: "Not sent yet: waiting for the bridge",
  sent: "Sent to Dash",
  working: "Dash is on it",
  answered: "Dash replied",
  failed: "Failed to send",
};

/** Newest first: each note the owner sent and where its reply stands. */
export function feedbackLoopItems(conversation: Conversation | undefined, limit = 5): FeedbackLoopItem[] {
  if (!conversation) return [];
  const items: FeedbackLoopItem[] = [];
  const messages = conversation.messages;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const next = messages[i + 1];
    const reply = next && next.role === "assistant" ? next : undefined;
    let status: FeedbackLoopStatus;
    if (message.delivery === "failed") status = "failed";
    else if (!reply) status = "sent";
    else if (reply.state === "error" || reply.state === "interrupted") status = "failed";
    else if (reply.state === "done") status = "answered";
    // A parked send (bridge offline) is pending until reconnect retries it.
    else if (reply.state === "pending" || reply.handoff === "queued") status = "unsent";
    else status = reply.text !== "" || reply.status !== undefined ? "working" : "sent";
    items.push({ id: message.id, text: message.text, at: message.at, status });
  }
  return items.reverse().slice(0, limit);
}
