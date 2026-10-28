import { registerReloadGuard } from "./live-update";
import { voicePhase } from "./voice-phase";
import { annotate } from "../store/annotate";
import { composerDrafts } from "../store/composer-drafts";
import { conversationBusy, store } from "../store/app";

/** Hold in-app live polling while losing the JS runtime would destroy user work. */
export function installReloadGuards(onChange: () => void): () => void {
  const unregister = [
    registerReloadGuard("voice call", () => !["idle", "error"].includes(voicePhase.get())),
    registerReloadGuard("annotation", () => {
      const state = annotate.get();
      return state.active || state.status === "capturing" || state.status === "sending" || state.pendingTurn !== undefined;
    }),
    registerReloadGuard("streaming reply", () =>
      store.get().conversations.some(conversation => conversationBusy(conversation.id))),
    registerReloadGuard("upload", () =>
      Object.values(composerDrafts.get()).some(draft => draft.attachments.some(item => item.state === "uploading"))),
    registerReloadGuard("unsent draft", () => {
      const id = store.get().activeId;
      if (id === null) return false;
      const draft = composerDrafts.get()[id];
      return draft !== undefined && (draft.text.trim().length > 0 || draft.attachments.length > 0);
    }),
  ];
  const unsubscribe = [
    voicePhase.subscribe(onChange),
    annotate.subscribe(onChange),
    store.subscribe(onChange),
    composerDrafts.subscribe(onChange),
  ];
  return () => {
    for (const dispose of [...unsubscribe, ...unregister]) dispose();
  };
}
