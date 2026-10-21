import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AssistantMessage, Conversation, Message } from "../model";
import { store } from "../store/app";
import { replyText } from "../store/text";
import { orbCaption } from "./orb-phase";
import { useSessionPhase, type ObservedPhase } from "./session-phase";
import { conversationThinking, type Thinking } from "./thinking";

const EMPTY: Message[] = [];

export type LiveThinking = {
  thinking: Thinking;
  caption: string;
  online: boolean;
  /** Work observed in the Hermes terminal while this phone is not running a turn. */
  external?: ObservedPhase;
  streamingMessage?: AssistantMessage;
};

/**
 * What the agent behind one conversation is doing right now: local in-flight turns first,
 * otherwise the gateway-observed phase (Hermes only). Shared by Chat and the Voice view.
 */
export function useLiveThinking(conversation: Conversation | undefined): LiveThinking {
  const settings = store.use((s) => s.settings);
  const connection = store.use((s) => s.connection);
  const messages = conversation?.messages ?? EMPTY;
  const harnessId = conversation?.harness ?? settings?.harness ?? "omp";
  const online = connection.status === "online";
  const streamingMessage = useMemo(() => {
    for (const m of messages) if (m.role === "assistant" && m.state === "streaming") return m;
    return undefined;
  }, [messages]);
  const replyId = streamingMessage?.turnId ?? "";
  const subscribeText = useCallback((notify: () => void) => replyText.subscribe(replyId, notify), [replyId]);
  const hasText = useCallback(() => Boolean(replyText.get(replyId)), [replyId]);
  // Header needs only the first-text edge, not a whole-screen render for every token.
  const liveText = useSyncExternalStore(subscribeText, hasText, hasText);
  const observed = useSessionPhase(settings, online && harnessId === "hermes", conversation?.profileId, conversation?.sessionId);
  const localThinking = conversationThinking(messages, connection.status);
  const thinking: Thinking = !online ? { phase: "idle" } : localThinking.phase !== "idle"
    ? (localThinking.phase === "thinking" && liveText && !streamingMessage?.status ? { phase: "streaming" } : localThinking)
    : observed?.observed ? observed : { phase: "idle" };
  const external = online && localThinking.phase === "idle" && observed?.observed && observed.phase !== "idle" ? observed : undefined;
  const observationUnavailable = online && harnessId === "hermes" && Boolean(conversation?.sessionId) && !observed?.observed;
  const caption = orbCaption(thinking, !online ? "offline" : observationUnavailable ? "status unavailable" : "idle");
  return { thinking, caption, online, external, streamingMessage };
}
