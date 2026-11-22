import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { parseSearchQuery } from "../lib/global-search";
import { lastExchange } from "../lib/last-exchange";
import type { OrbState } from "../lib/orb-phase";
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
  /** A running Live call: the composer mic shows its orb. */
  voiceCall?: OrbState;
  onDetach(): void;
}

/**
 * The main-screen composer keeps the exact chat's persisted draft and send target.
 * Harness settings are defaults for NEW chats, never authority for this one.
 */
export function AttachedComposer({ conversation, blurTarget, onOpen, onSearch, onVoice, voiceCall, onDetach }: Props) {
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
  const recent = lastExchange(conversation);
  const [peekOpen, setPeekOpen] = useState(false);
  useEffect(() => { setPeekOpen(false); }, [conversation.id]);
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
    setPeekOpen(false);
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
        {recent.you || recent.agent || recent.replying ? (
          <Pressable testID="attached-last-toggle" accessibilityRole="button" accessibilityState={{ expanded: peekOpen }}
            accessibilityLabel={peekOpen ? "Hide last messages" : "Show last messages"} onPress={() => setPeekOpen(open => !open)} style={styles.action}>
            <Text style={styles.actionText}>{peekOpen ? "Last ▾" : "Last ▸"}</Text>
          </Pressable>
        ) : null}
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
      {/* #507: last message or two, as an on-demand popup. Main never keeps a standing text copy of
          the transcript (army invariant: attached-composer.spec), so the text exists only while open. */}
      {peekOpen && (recent.you || recent.agent || recent.replying) ? (
        <Pressable testID="attached-last-exchange" accessibilityRole="button" accessibilityLabel="Open attached chat from last messages"
          onPress={onOpen} style={styles.recent}>
          {recent.you ? <Text testID="attached-last-you" numberOfLines={1} style={styles.recentYou}>You: {recent.you}</Text> : null}
          {recent.agent ? <Text testID="attached-last-agent" numberOfLines={2} style={styles.recentAgent}>{harnessName}: {recent.agent}</Text>
            : recent.replying ? <Text style={styles.recentYou}>{harnessName} is replying…</Text> : null}
        </Pressable>
      ) : null}
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
        voiceCall={voiceCall}
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
  recent: { marginHorizontal: space.sm, marginBottom: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderLeftWidth: 2, borderColor: colors.hair, gap: 2 },
  recentYou: { color: colors.textMuted, ...type.small },
  recentAgent: { color: colors.text, ...type.small },
});
