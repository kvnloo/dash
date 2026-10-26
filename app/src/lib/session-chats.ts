import type { Conversation } from "../model";

/** Conversations bound to a host or host session: what the Bots and Orchestra panes draw. */
export function sessionChats(state: { conversations: Conversation[] }): Conversation[] {
  return state.conversations.filter(chat => chat.sessionId !== undefined || chat.targetHostId !== undefined);
}
