/**
 * One-shot cold-start navigation gate. Store hydration already retains activeId,
 * messages, sessionId and streaming turn sequence. This only restores the screen.
 *
 * Never call during foreground resumes: keeping the user's current screen is safer
 * than forcibly navigating back into an earlier chat.
 */
export interface ChatResumeInput {
  hydrated: boolean;
  navigationReady: boolean;
  initialLinkResolved: boolean;
  initialLinkHandled: boolean;
  userNavigated: boolean;
  paired: boolean;
  currentRoute: string | undefined;
  activeId: string | null;
  conversations: ReadonlyArray<{ id: string }>;
}

export type ChatResumeDecision =
  | { kind: "wait" }
  | { kind: "skip" }
  | { kind: "open"; conversationId: string };

export interface ChatResumeGate {
  decide(input: ChatResumeInput): ChatResumeDecision;
  isSettled(): boolean;
}

export function createChatResumeGate(): ChatResumeGate {
  let settled = false;
  return {
    decide(input): ChatResumeDecision {
      if (settled) return { kind: "skip" };
      if (!input.hydrated || !input.navigationReady || !input.initialLinkResolved) {
        return { kind: "wait" };
      }

      // A Pair deep link, notification, tab navigation or already-open Chat wins.
      // This decision happens only once after both hydration and initial URL settle.
      settled = true;
      if (input.initialLinkHandled || input.userNavigated || !input.paired || input.currentRoute !== "Main") {
        return { kind: "skip" };
      }
      const id = input.activeId;
      if (!id || !id.trim()) return { kind: "skip" };
      const matching = input.conversations.filter((c) => c.id === id);
      if (matching.length !== 1) return { kind: "skip" };
      // Return the exact persisted id; no createConversation, setActive or send.
      return { kind: "open", conversationId: matching[0]!.id };
    },
    isSettled(): boolean {
      return settled;
    },
  };
}
