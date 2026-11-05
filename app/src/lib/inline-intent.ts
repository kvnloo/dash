import type { LiveIntent } from "../../../shared/live";
import { parseLiveIntent } from "../../../shared/live";
import { sendChat, sendLiveIntent } from "../net/bridge";
import { applyTurnEvent, beginTurn, locateTurn, store } from "../store/app";
import { liveOf } from "../store/live";

/** Source-turn owned, ordinary user intent, never a tool/approval or model-selected command. */
export function sendInlineIntent(sourceTurn: string, raw: LiveIntent): boolean {
  const intent = parseLiveIntent(raw);
  const where = locateTurn(sourceTurn);
  const state = store.get();
  const conversation = state.conversations.find(c => c.id === where?.conversationId);
  if (!intent || !conversation || conversation.id !== state.activeId || conversation.stale || state.connection.status !== "online") return false;
  if (conversation.messages.some(m => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"))) return false;
  const live = liveOf(conversation.id);
  if (live.open && live.status === "ready") return sendLiveIntent(conversation.id, intent);
  // live_intent requires a libfx worker; omp and ordinary Hermes instead receive the same
  // validated LiveIntent as a visible user message in their existing session, without creating a worker.
  const text = `UI choice from reply ${sourceTurn}:\n${JSON.stringify(intent)}`;
  const { turnId } = beginTurn(conversation.id, text);
  const ok = sendChat({ turnId, harness: conversation.harness, text, sessionId: conversation.sessionId, cwd: conversation.cwd });
  if (!ok) applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "UI choice was not sent. Reconnect and try again." });
  return ok;
}
