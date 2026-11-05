import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { parseSearchQuery } from "../lib/global-search";
import { Composer } from "./Composer";
import { haptic } from "../haptics";
import { bridge, sendChat } from "../net/bridge";
import { colors, space, type } from "../theme";
import {
  beginTurn, changeQueuePreview, conversationBusy, conversationTargetError,
  flushPendingSends, parkUnsentTurn, saveQueuePreview, stopConversation, store,
} from "../store/app";
import { composerDrafts, updateComposerDraft, type ComposerDraft } from "../store/composer-drafts";
import { onTurnSettled } from "../store/queue";

interface Props {
  conversation: Conversation;
  blurTarget?: RefObject<View | null>;
  onOpen(): void;
  onSearch(query?: string): void;
  onVoice(): void;
  onDetach(): void;
}

/**
 * The main-screen composer keeps the exact chat's persisted draft and send target.
 * Harness settings are defaults for NEW chats, never authority for this one.
 */
export function AttachedComposer({ conversation, blurTarget, onOpen, onSearch, onVoice, onDetach }: Props) {
  const online = store.use(state => state.connection.status === "online");
  const draft = composerDrafts.use(all => all[conversation.id]);
  const priorDraft = useRef<{ id: string; value: ComposerDraft } | null>(null);

  // Main's search scopes are not agent prompts. Hand them to search without
  // replacing the exact selected conversation's saved draft.
  useEffect(() => {
    const current = draft ?? { text: "", attachments: [] };
    const previous = priorDraft.current;
    priorDraft.current = { id: conversation.id, value: current };
    if (!previous || previous.id !== conversation.id || previous.value.text === current.text) return;
    const parsed = parseSearchQuery(current.text);
    if ((parsed.mode !== "slash" && parsed.mode !== "mention") ||
      parsed.scope === "unknown" || !/^[@/]\w+\s/.test(current.text.trimStart())) return;
    updateComposerDraft(conversation.id, current, () => previous.value);
    onSearch(current.text);
  }, [conversation.id, draft, onSearch]);

  const harnessName = store.use(state => state.connection.harnesses.find(harness => harness.id === conversation.harness)?.name) ?? conversation.harness;
  const blocked = conversationTargetError(conversation);
  const busy = conversationBusy(conversation.id);
  const sessionModel = conversation.sessionId && conversation.sessionModel?.sessionId === conversation.sessionId
    ? conversation.sessionModel.model : undefined;
  const targetLabel = [
    harnessName,
    conversation.profileName ?? conversation.title,
    conversation.sessionId ? "session " + conversation.sessionId : "new session",
    ...(sessionModel ? ["model " + sessionModel] : []),
    ...(conversation.targetHostId ? ["host " + conversation.targetHostId] : []),
  ].join(" · ");

  useEffect(() => onTurnSettled(id => {
    if (id === conversation.id && store.get().connection.status === "online") flushPendingSends(sendChat);
  }), [conversation.id]);

  useEffect(() => {
    if (online) flushPendingSends(sendChat);
  }, [conversation.id, online]);

  const onSend = useCallback((text: string, attachments: ChatAttachment[]) => {
    const state = store.get();
    const current = state.conversations.find(chat => chat.id === conversation.id);
    // A navigation, endpoint or roster change must never turn the draft into a
    // request for some other session. The component itself also disables Send.
    if (!current || state.activeId !== current.id || state.connection.status !== "online" || conversationTargetError(current)) {
      updateComposerDraft(conversation.id, { text, attachments: [] }, draft => ({ ...draft, text }));
      return;
    }
    if (conversationBusy(current.id)) {
      beginTurn(current.id, text, { pending: true, attachments });
      haptic.tap();
      return;
    }
    const { turnId } = beginTurn(current.id, text, { attachments, mode: "queue" });
    haptic.tap();
    if (!sendChat({
      turnId, harness: current.harness, text, sessionId: current.sessionId,
      cwd: current.cwd, attachments,
    })) parkUnsentTurn(turnId);
  }, [conversation.id]);

  return (
    <View testID="attached-composer" style={styles.root}>
      <View style={styles.header}>
        <Text testID="attached-composer-target" accessibilityLabel={"Attached to " + targetLabel}
          numberOfLines={1} style={styles.target}>{targetLabel}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open attached chat" onPress={onOpen} style={styles.action}>
          <Text style={styles.actionText}>Open</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Search chats and tools" onPress={() => onSearch()} style={styles.action}>
          <Text style={styles.actionText}>Search</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Detach from session" onPress={onDetach} style={styles.action}>
          <Text style={styles.actionText}>Detach</Text>
        </Pressable>
      </View>
      {blocked ? <Text accessibilityRole="alert" style={styles.blocked}>{blocked}</Text> : null}
      <Composer
        draftKey={conversation.id}
        harness={conversation.harness}
        cwd={conversation.cwd}
        blurTarget={blurTarget}
        disabled={!online || blocked !== undefined}
        streaming={busy}
        queuePreview={conversation.queuePreview}
        onQueuePreviewChange={value => changeQueuePreview(conversation.id, value)}
        onSaveQueuePreview={() => saveQueuePreview(conversation.id)}
        placeholder={"Message " + harnessName}
        onSend={onSend}
        onStop={() => stopConversation(conversation.id, id => { void bridge.send({ type: "cancel", id }); })}
        onVoice={onVoice}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", backgroundColor: colors.bg },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm },
  target: { flex: 1, minWidth: 0, color: colors.gold, ...type.small },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: space.xs, alignItems: "center", justifyContent: "center" },
  actionText: { color: colors.text, ...type.label },
  blocked: { color: colors.danger, paddingHorizontal: space.md, ...type.small },
});
