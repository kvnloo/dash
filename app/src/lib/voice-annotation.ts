import type { ChatAttachment } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { sendChat } from "../net/bridge";
import { annotate } from "../store/annotate";
import { partsFor, replyParts, replyText } from "../store/text";
import { applyTurnEvent, beginTurn, conversationTargetError, store } from "../store/app";
import { annotationReceipt } from "./voice-annotation-receipt";

/** One exact bridge turn. A lost ack preserves the drawing and the original turn id.
 * Retrying checks that receipt; it never submits a second message.
 */
export async function sendVoiceAnnotation(conversation: Conversation, text: string, attachments: ChatAttachment[], final: (id: string, text: string) => void, mode: "steer" | "queue" = "queue", submitted?: (id: string) => void): Promise<void> {
  const pending = annotate.get().pendingTurn;
  const draft = annotate.get();
  const fingerprint = JSON.stringify([draft.drawing.strokes, draft.segments]);
  if (pending && pending.conversationId !== conversation.id) throw new Error("An annotation is awaiting its original conversation receipt. Check it before sending elsewhere.");
  if (pending && pending.fingerprint !== fingerprint) throw new Error("The drawing changed while the original delivery was unconfirmed. Both are kept; check the original conversation before sending again.");
  let turnId = pending?.id;
  if (!turnId) {
    if (store.get().connection.status !== "online") throw new Error("Offline. Drawing and spoken intent are kept; reconnect before sending.");
    const targetError = conversationTargetError(conversation);
    if (targetError) throw new Error(targetError);
    turnId = beginTurn(conversation.id, text, { attachments, mode }).turnId;
    const id = turnId;
    annotate.set(s => ({ ...s, pendingTurn: { id, conversationId: conversation.id, fingerprint } }));
    const sent = sendChat({ turnId, harness: conversation.harness, text, sessionId: conversation.sessionId, cwd: conversation.cwd, attachments, mode });
    if (!sent) {
      applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Annotation was not sent: bridge offline." });
      annotate.set(s => ({ ...s, pendingTurn: undefined }));
      throw new Error("Offline. Annotation was not sent; drawing is kept.");
    }
  }
  const exactTurn = turnId;
  // Accepted is not final; keep the auto-started voice call bound to this exact turn.
  submitted?.(exactTurn);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let off = () => {};
    let offText = () => {};
    let offParts = () => {};
    // The empty seq-0 placeholder is not a receipt. Only a turn with no
    // bridge event or streamed content can reach this deadline.
    const receiptTimer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("Delivery unconfirmed. Drawing is kept. Check the original turn; do not send a duplicate.")); }
    }, 30_000);
    const lifetime = setTimeout(() => { off(); offText(); offParts(); clearTimeout(receiptTimer); }, 5 * 60_000);
    const stopWatching = () => {
      off(); offText(); offParts();
      clearTimeout(receiptTimer); clearTimeout(lifetime);
    };
    const clearPending = () => {
      annotate.set(s => s.pendingTurn?.id === exactTurn ? { ...s, pendingTurn: undefined } : s);
    };
    const inspect = () => {
      const current = store.get().conversations.find(c => c.id === conversation.id);
      const reply = current?.messages.find(m => m.role === "assistant" && m.turnId === exactTurn);
      if (!reply || reply.role !== "assistant") return;
      // Token/part updates live outside the conversation store to avoid
      // rerendering the entire chat. Observe those same streams for this receipt.
      const streamedParts = partsFor(exactTurn);
      const receipt = annotationReceipt({
        ...reply,
        text: replyText.get(exactTurn) || reply.text,
        parts: streamedParts.length ? streamedParts : reply.parts,
      });
      if (receipt === "failed") {
        stopWatching();
        if (!settled) { settled = true; reject(new Error("The annotation turn failed or was interrupted. Check its receipt before retrying; drawing is kept.")); }
      } else if (receipt === "final") {
        stopWatching();
        if (reply.text.trim()) final(exactTurn, reply.text);
        if (!settled) { settled = true; clearPending(); resolve(); }
      } else if (receipt === "accepted") {
        clearTimeout(receiptTimer);
        // Keep watching the conversation for the eventual final reply, but
        // streaming deltas no longer need to inspect an accepted receipt.
        offText(); offParts();
        if (!settled) { settled = true; clearPending(); resolve(); }
      }
    };
    off = store.subscribe(inspect);
    offText = replyText.subscribe(exactTurn, inspect);
    offParts = replyParts.subscribe(exactTurn, inspect);
    inspect();
  });
}
