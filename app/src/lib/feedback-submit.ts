import { sendChat } from "../net/bridge";
import { applyTurnEvent, beginTurn, createConversation, store } from "../store/app";
import {
  FEEDBACK_CONVERSATION_ID,
  submitFeedback,
  type FeedbackAction,
  type FeedbackIssue,
} from "./feedback";

export function submitInAppFeedback(action: FeedbackAction): { conversationId: string; issue: FeedbackIssue } {
  const harness = store.get().settings?.harness ?? "omp";
  let conversationId = FEEDBACK_CONVERSATION_ID;
  const { issue } = submitFeedback(action, {
    steer: (prompt) => {
      const conversation = createConversation(harness, {
        id: FEEDBACK_CONVERSATION_ID,
        title: "Dash feedback",
      });
      conversationId = conversation.id;
      const { turnId } = beginTurn(conversation.id, action.text.trim() || issue.title);
      const current = store.get().conversations.find((c) => c.id === conversation.id) ?? conversation;
      const ok = sendChat({
        turnId,
        harness: current.harness,
        text: prompt,
        sessionId: current.sessionId,
        cwd: current.cwd,
      });
      if (!ok) {
        applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Not connected to the bridge." });
      }
    },
  });
  return { conversationId, issue };
}
