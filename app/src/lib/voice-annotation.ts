import type { ChatAttachment } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { sendChat } from "../net/bridge";
import { annotate } from "../store/annotate";
import { applyTurnEvent, beginTurn, store } from "../store/app";

/** One exact bridge turn. A lost ack preserves the drawing and the original turn id.
 * Retrying checks that receipt; it never submits a second message.
 */
export async function sendVoiceAnnotation(conversation: Conversation, text: string, attachments: ChatAttachment[], final: (id: string, text: string) => void): Promise<void> {
  const pending = annotate.get().pendingTurn;
  const draft = annotate.get();
  const fingerprint = JSON.stringify([draft.drawing.strokes, draft.segments]);
  if (pending && pending.conversationId !== conversation.id) throw new Error("An annotation is awaiting its original conversation receipt. Check it before sending elsewhere.");
  if (pending && pending.fingerprint !== fingerprint) throw new Error("The drawing changed while the original delivery was unconfirmed. Both are kept; check the original conversation before sending again.");
  let turnId = pending?.id;
  if (!turnId) {
    if (store.get().connection.status !== "online") throw new Error("Offline. Drawing and spoken intent are kept; reconnect before sending.");
    turnId = beginTurn(conversation.id, text, { attachments, mode: "queue" }).turnId;
    const id = turnId;
    annotate.set(s => ({ ...s, pendingTurn: { id, conversationId: conversation.id, fingerprint } }));
    const sent = sendChat({ turnId, harness: "hermes", text, sessionId: conversation.sessionId, cwd: conversation.cwd, attachments, mode: "queue" });
    if (!sent) {
      applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Annotation was not sent: bridge offline." });
      annotate.set(s => ({ ...s, pendingTurn: undefined }));
      throw new Error("Offline. Annotation was not sent; drawing is kept.");
    }
  }
  const exactTurn = turnId;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let off = () => {};
    const receiptTimer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("Delivery unconfirmed. Drawing is kept. Check the original turn; do not send a duplicate.")); }
    }, 30_000);
    const lifetime = setTimeout(() => { off(); clearTimeout(receiptTimer); }, 5 * 60_000);
    const inspect = () => {
      const current = store.get().conversations.find(c => c.id === conversation.id);
      const reply = current?.messages.find(m => m.role === "assistant" && m.turnId === exactTurn);
      if (!reply || reply.role !== "assistant") return;
      if (reply.state === "error" || reply.state === "interrupted") {
        off(); clearTimeout(receiptTimer); clearTimeout(lifetime);
        if (!settled) { settled = true; reject(new Error("The annotation turn failed or was interrupted. Check its receipt before retrying; drawing is kept.")); }
      } else if (reply.state === "done") {
        off(); clearTimeout(receiptTimer); clearTimeout(lifetime);
        if (reply.text.trim()) final(exactTurn, reply.text);
        if (!settled) { settled = true; resolve(); }
      } else if (reply.delivery === "started" || reply.state === "streaming") {
        // A local/pre-submit 'queued' marker is not proof of gateway acceptance.
        clearTimeout(receiptTimer);
        if (!settled) { settled = true; resolve(); }
      }
    };
    off = store.subscribe(inspect); inspect();
  });
}
