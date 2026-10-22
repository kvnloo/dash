import type { ChatAttachment } from "../../../shared/protocol";
import type { Conversation } from "../model";
import type { SendMode } from "../lib/composer-mode";
import { deliveryPlan } from "../lib/attached-dock";
import { applyTurnEvent, beginTurn, conversationBusy, conversationTargetError, parkUnsentTurn, setQueueWaiting, store } from "../store/app";
import type { sendChat } from "./bridge";

/** Shared Chat/dock delivery: same identity, pending pairs, steer failure and offline policy. */
export function sendConversation(active: Conversation, text: string, attachments: ChatAttachment[], mode: SendMode, phase: string, streaming: boolean, send: typeof sendChat): boolean {
  const current = store.get().conversations.find(c => c.id === active.id);
  if (!current || conversationTargetError(current)) return false;
  const plan = deliveryPlan(mode, conversationBusy(current.id), phase, streaming);
  if (plan !== "send") {
    if (plan === "wait") setQueueWaiting(current.id, true);
    beginTurn(current.id, text, { pending: true, attachments });
    return true;
  }
  const { turnId } = beginTurn(current.id, text, { attachments, mode });
  const ok = send({ turnId, harness: current.harness, mode, text, sessionId: current.sessionId, cwd: current.cwd, attachments });
  if (!ok) {
    if (mode === "steer") applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Offline: steer was not sent. It will not be retried automatically." });
    else parkUnsentTurn(turnId);
  }
  return true;
}
