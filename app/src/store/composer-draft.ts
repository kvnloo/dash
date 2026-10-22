import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { DraftAttachment } from "../lib/attachments";
import { createStore } from "./createStore";

type Draft = { text: string; attachments: DraftAttachment[] };
const composerDrafts = createStore<Record<string, Draft>>({});
/** One draft per attached identity, shared by Chat and the persistent outside-chat input.
 * Upload completions may arrive after a screen unmounts, so updates target the identity, not a view.
 * Ephemeral file URIs deliberately are not persisted across process restarts. */
export function useComposerDraft(key: string | undefined, initialText = "", initialAttachments: DraftAttachment[] = []) {
  const [local, setLocal] = useState<Draft>({ text: initialText, attachments: initialAttachments });
  const stored = composerDrafts.use(s => key ? s[key] : undefined);
  const state = stored ?? local;
  const setText = useCallback((value: SetStateAction<string>) => {
    const update = (draft: Draft): Draft => ({ ...draft, text: typeof value === "function" ? value(draft.text) : value });
    if (key) composerDrafts.set(s => ({ ...s, [key]: update(s[key] ?? { text: initialText, attachments: initialAttachments }) }));
    else setLocal(update);
  }, [key, initialText, initialAttachments]);
  const setAttachments = useCallback((value: SetStateAction<DraftAttachment[]>) => {
    const update = (draft: Draft): Draft => ({ ...draft, attachments: typeof value === "function" ? value(draft.attachments) : value });
    if (key) composerDrafts.set(s => ({ ...s, [key]: update(s[key] ?? { text: initialText, attachments: initialAttachments }) }));
    else setLocal(update);
  }, [key, initialText, initialAttachments]);
  useEffect(() => { if (initialText) setText(initialText); }, [initialText]);
  return { text: state.text, drafts: state.attachments, setText, setDrafts: setAttachments };
}
