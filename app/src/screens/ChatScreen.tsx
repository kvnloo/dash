import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "../components/Composer";
import { composerPlaceholder } from "./composer-placeholder";
import { KeyboardDock, KeyboardInsetView } from "../components/KeyboardDock";
import { ConnectionPill } from "../components/ConnectionPill";
import { HarnessPicker } from "../components/HarnessPicker";
import { AppNav } from "../components/AppNav";
import { MessageRow } from "../components/MessageRow";
import { LiveSurface } from "../components/LiveSurface";
import { PressScale } from "../components/PressScale";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Message } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge, openLiveSurface, sendChat, sendLiveTurn } from "../net/bridge";
import { EMPTY_LIVE, liveOf, liveStore, setLiveOpen } from "../store/live";
import {
  beginTurn,
  conversationBusy,
  conversationTargetError,
  createConversation,
  parkUnsentTurn,
  promotePendingTurn,
  saveSettings,
  setActive,
  stopConversation,
  store,
} from "../store/app";
import { dequeue, enqueue, onTurnSettled, queueLength } from "../store/queue";
import { colors, glass, radius, space, type } from "../theme";
import { toMain } from "../lib/main-nav";
import { AgentOrb } from "../components/AgentOrb";
import { PromptRail } from "../components/PromptRail";
import { followsLatest, promptAnchors, promptOffset } from "../lib/prompt-navigation";

const EMPTY: Message[] = [];

function keyExtractor(item: Message): string {
  return item.id;
}

function getItemType(item: Message): string {
  return item.role;
}

function renderItem({ item }: ListRenderItemInfo<Message>, harnessId: string) {
  return <MessageRow message={item} harnessId={harnessId} />;
}

export function ChatScreen({ navigation, route }: ScreenProps<"Chat">) {
  const composerDraft = route.params?.draft;
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlashListRef<Message>>(null);
  const followRef = useRef(true);
  const dragging = useRef(false);
  const [following, setFollowing] = useState(true);
  const setFollow = useCallback((next: boolean) => { followRef.current = next; setFollowing(next); }, []);
  const scrollToNewest = useCallback(() => {
    if (followRef.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, []);
  const debugPicker = debugUi.use((s) => s.chatHarnessPickerOpen);
  const debugAttachments = debugUi.use((s) => s.chatComposerAttachments);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerVisible = debugPicker ?? pickerOpen;
  const setPickerVisible = useCallback((open: boolean) => {
    setPickerOpen(open);
    if (isDebugActive()) debugUi.set((s) => ({ ...s, chatHarnessPickerOpen: open }));
  }, []);

  const settings = store.use((s) => s.settings);
  const connection = store.use((s) => s.connection);
  const conversation = store.use((s) => s.conversations.find((c) => c.id === s.activeId));
  const messages = conversation?.messages ?? EMPTY;
  const anchors = useMemo(() => promptAnchors(messages), [messages]);
  useEffect(() => { setFollow(true); }, [conversation?.id, setFollow]);
  const jumpPrompt = useCallback((prompt: number) => {
    const anchor = anchors[prompt];
    if (!anchor) return;
    setFollow(false);
    const offset = promptOffset(anchors, prompt, index => listRef.current?.getLayout(index));
    if (offset !== null) listRef.current?.scrollToOffset({ offset, animated: false });
    else void listRef.current?.scrollToIndex({ index: anchor.index, animated: false, viewPosition: 0 });
  }, [anchors, setFollow]);
  const harnessId = conversation?.harness ?? settings?.harness ?? "omp";
  const harness = connection.harnesses.find((h) => h.id === harnessId);
  const harnessName = harness?.name ?? harnessId;
  const online = connection.status === "online";
  const targetError = conversation ? conversationTargetError(conversation) : undefined;
  const live = liveStore.use((all) => (conversation ? all[conversation.id] ?? EMPTY_LIVE : EMPTY_LIVE));
  const liveOn = harnessId === "hermes" && live.open;

  const toggleLive = useCallback(() => {
    const active = conversation ?? createConversation("hermes");
    const next = !liveOf(active.id).open;
    haptic.select();
    setLiveOpen(active.id, next);
    if (next && liveOf(active.id).status !== "ready") openLiveSurface(active.id, { profileId: active.profileId, sessionId: active.sessionId });
  }, [conversation]);

  const onLiveSend = useCallback((text: string) => {
    if (conversation) { haptic.tap(); sendLiveTurn(conversation.id, text); }
  }, [conversation]);

  const streamingMessage = useMemo(() => {
    return messages.find((m) => m.role === "assistant" && m.state === "streaming");
  }, [messages]);

  const sendTurn = useCallback(
    (text: string, attachments: ChatAttachment[], active = conversation ?? createConversation(harnessId)) => {
      const { turnId } = beginTurn(active.id, text, { attachments });
      haptic.tap();
      const current = store.get().conversations.find((c) => c.id === active.id) ?? active;
      const ok = sendChat({
        turnId,
        harness: current.harness,
        text,
        sessionId: current.sessionId,
        cwd: current.cwd,
        attachments,
      });
      if (!ok) {
        parkUnsentTurn(turnId);
      }
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    },
    [conversation, harnessId],
  );

  const flushQueue = useCallback(
    (conversationId: string) => {
      if (!online) return;
      const conv = store.get().conversations.find((c) => c.id === conversationId);
      if (!conv) return;
      if (conversationBusy(conversationId) && conv.messages.some((m) => m.role === "assistant" && m.state === "streaming")) {
        return;
      }
      const turnId = dequeue(conversationId);
      if (!turnId) return;
      const payload = promotePendingTurn(turnId);
      if (!payload) {
        flushQueue(conversationId);
        return;
      }
      haptic.tap();
      const current = store.get().conversations.find((c) => c.id === conversationId);
      const ok = sendChat({
        turnId,
        harness: payload.harness,
        text: payload.text,
        sessionId: current?.sessionId ?? payload.sessionId,
        cwd: current?.cwd,
        attachments: payload.attachments,
      });
      if (!ok) {
        parkUnsentTurn(turnId);
        return;
      }
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    },
    [online],
  );

  const onSend = useCallback(
    (text: string, attachments: ChatAttachment[]) => {
      const active = conversation ?? createConversation(harnessId);
      if (conversationBusy(active.id)) {
        const { turnId } = beginTurn(active.id, text, { pending: true, attachments });
        enqueue(active.id, turnId);
        haptic.tap();
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      sendTurn(text, attachments, active);
    },
    [conversation, harnessId, sendTurn],
  );

  useEffect(() => {
    if (!conversation) return;
    return onTurnSettled((id) => {
      if (id === conversation.id) flushQueue(id);
    });
  }, [conversation?.id, flushQueue]);

  useEffect(() => {
    if (conversation && !streamingMessage && queueLength(conversation.id) > 0) flushQueue(conversation.id);
  }, [conversation?.id, streamingMessage, flushQueue]);

  useEffect(() => {
    if (online && conversation && queueLength(conversation.id) > 0) flushQueue(conversation.id);
  }, [online, conversation?.id, flushQueue]);

  const onStop = useCallback(() => {
    if (conversation) stopConversation(conversation.id, (id) => { bridge.send({ type: "cancel", id }); });
  }, [conversation]);

  const onSelectHarness = useCallback(
    (id: string) => {
      if (!settings) return;
      haptic.select();
      saveSettings({ ...settings, harness: id });
      // Sessions are harness-specific, so switching mid-conversation starts a fresh chat.
      if (conversation && conversation.messages.length > 0) setActive(null);
    },
    [settings, conversation],
  );


  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}><Canvas />
      <AppNav navigation={navigation} tab={1} />
      <ScreenHeader compact title={conversation?.title || harnessName} onBack={() => toMain(navigation)} action="Choose harness" icon="sliders" onAction={() => setPickerVisible(true)} />
      <ConnectionPill />
      {targetError ? <Text accessibilityRole="alert" style={styles.targetError}>{targetError}</Text> : null}
      {!targetError && conversation?.openIn ? (
        <Text accessibilityRole="text" style={styles.handoffNote}>
          Open in {conversation.openIn} on {connection.hosts.find((h) => h.id === conversation.targetHostId)?.name ?? connection.host ?? "the host"}. Replies wait until it closes there.
        </Text>
      ) : null}
      {harnessId === "hermes" ? (
        <View style={styles.liveRow}>
          <PressScale accessibilityRole="switch" accessibilityLabel="Live surface" accessibilityState={{ checked: liveOn }} aria-checked={liveOn}
            onPress={toggleLive} style={[styles.liveChip, liveOn && styles.liveChipOn]}>
            <Text style={[styles.liveChipText, liveOn && styles.liveChipTextOn]}>Live surface</Text>
          </PressScale>
          <Text style={styles.liveNote} numberOfLines={1}>{liveOn ? "fast lane · Hermes stays in charge" : "Hermes chat"}</Text>
        </View>
      ) : null}
      {liveOn && conversation ? <KeyboardInsetView style={styles.body}><LiveSurface conversationId={conversation.id} /></KeyboardInsetView> : <KeyboardInsetView style={styles.body} onOpen={scrollToNewest}>
        <FlashList
          ref={listRef}
          data={messages}
          renderItem={(info) => renderItem(info, harnessId)}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
          onScrollBeginDrag={() => { dragging.current = true; }}
          onScroll={event => {
            if (!dragging.current) return;
            const { contentSize, layoutMeasurement, contentOffset } = event.nativeEvent;
            setFollow(followsLatest(contentSize.height, layoutMeasurement.height, contentOffset.y));
          }}
          scrollEventThrottle={16}
          onContentSizeChange={scrollToNewest}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <AgentOrb size={64} thinking={{ phase: "idle" }} label={`${harnessName} idle`} />
              <Text style={styles.emptyTitle}>{harnessName}</Text>
              <Text style={styles.emptySubtitle}>
                {online && connection.host ? `on ${connection.host}` : "Ask anything"}
              </Text>
            </View>
          }
        />
        <PromptRail anchors={anchors} following={following} live={Boolean(streamingMessage)} onJump={jumpPrompt}
          onLatest={() => { dragging.current = false; setFollow(true); scrollToNewest(); }} />
      </KeyboardInsetView>}
      <KeyboardDock>
        <Composer
          key={composerDraft ?? (debugAttachments ? "debug-attachments" : "composer")}
          initialAttachments={isDebugActive() ? debugAttachments ?? undefined : undefined}
          disabled={!online || targetError !== undefined || (liveOn && live.status !== "ready")}
          streaming={liveOn ? live.busy : conversation ? conversationBusy(conversation.id) : false}
          initialText={composerDraft}
          placeholder={liveOn ? (live.askHermes ? "Ask Hermes through the live surface" : "Live surface · quick reply") : composerPlaceholder({
            online,
            streaming: Boolean(streamingMessage),
            queued: conversation ? queueLength(conversation.id) : 0,
            openIn: conversation?.openIn,
            harnessName,
          })}
          onSend={liveOn ? onLiveSend : onSend}
          onStop={onStop}
          onVoice={() => navigation.navigate("Voice")}
        />
      </KeyboardDock>
      <HarnessPicker
        visible={pickerVisible}
        harnesses={connection.harnesses}
        selected={harnessId}
        onSelect={onSelectHarness}
        onClose={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  targetError: { color: colors.danger, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  handoffNote: { color: colors.textTertiary, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { flex: 1 },
  listContent: { paddingVertical: space.sm, paddingRight: 36 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: "45%" },
  emptyTitle: { color: colors.text, ...type.title },
  emptySubtitle: { color: colors.textMuted, ...type.body, marginTop: 6 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.xs },
  liveChip: { height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair, backgroundColor: glass.fillChip, paddingHorizontal: space.md, justifyContent: "center" },
  liveChipOn: { borderColor: colors.gold, backgroundColor: glass.fillChipOn },
  liveChipText: { ...type.label, color: colors.textMuted },
  liveChipTextOn: { color: colors.gold },
  liveNote: { ...type.mono, color: colors.textTertiary, flex: 1 },
});
