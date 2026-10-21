import { DETAIL_MODES } from "../lib/reply-details";
import { useHandedness } from "../lib/useHandedness";
import { BlurTargetView } from "expo-blur";
import { Canvas } from "../components/Canvas";
import { setThinkingSummaries } from "../store/app";
import { ScreenHeader } from "../components/ScreenHeader";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "../components/Composer";
import { composerPlaceholder } from "./composer-placeholder";
import { sessionViewerLabel } from "./session-viewer-label";
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
import { canSteer, type SendMode } from "../lib/composer-mode";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Message } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge, openLiveSurface, sendChat, sendLiveTurn } from "../net/bridge";
import { EMPTY_LIVE, liveOf, liveStore, setLiveOpen } from "../store/live";
import {
  applyTurnEvent,
  beginTurn,
  conversationBusy,
  conversationTargetError,
  createConversation,
  parkUnsentTurn,
  promotePendingTurn,
  saveSettings,
  setActive,
  setDetailMode,
  stopConversation,
  store,
} from "../store/app";
import { dequeue, enqueue, onTurnSettled, queueLength } from "../store/queue";
import { colors, glass, radius, space, type } from "../theme";
import { useLiveThinking } from "../lib/live-thinking";
import { useSessionActivity } from "../lib/session-activity";
import { screenBack } from "../lib/screen-back";
import { AgentOrb } from "../components/AgentOrb";
import { approvals, actionable } from "../store/approvals";
import { PromptRail } from "../components/PromptRail";
import { followsLatest, promptOffset } from "../lib/prompt-navigation";
import { railTurns } from "../lib/rail-turns";

const EMPTY: Message[] = [];

function keyExtractor(item: Message): string {
  return item.id;
}

function getItemType(item: Message): string {
  return item.role;
}

export function ChatScreen({ navigation, route }: ScreenProps<"Chat">) {
  const thumb = useHandedness();
  const composerDraft = route.params?.draft;
  const insets = useSafeAreaInsets();
  const blurTarget = useRef<View>(null);
  const listRef = useRef<FlashListRef<Message>>(null);
  const followRef = useRef(true);
  const dragging = useRef(false);
  const previousOffset = useRef(0);
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

  const approvalCount = approvals.use(s => s.items.filter(actionable).length);
  const approvalDryRun = approvals.use(s => s.dryRun);
  const settings = store.use((s) => s.settings);
  const connection = store.use((s) => s.connection);
  const conversation = store.use((s) => s.conversations.find((c) => c.id === s.activeId));
  const messages = conversation?.messages ?? EMPTY;
  const anchors = useMemo(() => railTurns(messages), [messages]);
  useEffect(() => { setFollow(true); }, [conversation?.id, setFollow]);
  const jumpPrompt = useCallback((prompt: number) => {
    const anchor = anchors[prompt];
    if (!anchor) return;
    dragging.current = false;
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

  const { thinking, caption, external, streamingMessage } = useLiveThinking(conversation);
  useSessionActivity(settings, online && harnessId === "hermes" && !streamingMessage, conversation?.profileId, conversation?.sessionId, conversation?.targetHostId);
  const latestAssistant = [...messages].reverse().find(message => message.role === "assistant");

  const sendTurn = useCallback(
    (text: string, attachments: ChatAttachment[], active = conversation ?? createConversation(harnessId), mode: SendMode = "queue") => {
      const { turnId } = beginTurn(active.id, text, { attachments, mode });
      haptic.tap();
      const current = store.get().conversations.find((c) => c.id === active.id) ?? active;
      const ok = sendChat({
        turnId,
        harness: current.harness,
        mode,
        text,
        sessionId: current.sessionId,
        cwd: current.cwd,
        attachments,
      });
      if (!ok) {
        if (mode === "steer") applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Offline: steer was not sent. It will not be retried automatically." });
        else parkUnsentTurn(turnId);
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
      if (followRef.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    },
    [online],
  );

  const onSend = useCallback(
    (text: string, attachments: ChatAttachment[], mode: SendMode = "queue") => {
      dragging.current = false;
      setFollow(true);
      const active = conversation ?? createConversation(harnessId);
      if (mode === "steer") { sendTurn(text, attachments, active, "steer"); return; }
      if (conversationBusy(active.id)) {
        const { turnId } = beginTurn(active.id, text, { pending: true, attachments });
        enqueue(active.id, turnId);
        haptic.tap();
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      sendTurn(text, attachments, active);
    },
    [conversation, harnessId, sendTurn, setFollow],
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
      if (conversation && conversation.harness !== id) setActive(null);
    },
    [settings, conversation],
  );


  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}><Canvas />
      <AppNav navigation={navigation} tab={1} />
      <ScreenHeader compact title={conversation?.title || harnessName} onBack={() => screenBack(navigation)} />
      <View style={styles.liveRow} accessibilityLabel={`${harnessName} ${caption}`}><AgentOrb size={20} thinking={thinking} /><Text style={styles.liveNote}>{caption}{external ? " · terminal" : ""}</Text></View>
      <ConnectionPill />
      {conversation ? <PressScale accessibilityRole="switch" accessibilityLabel="Thinking summaries" accessibilityState={{ checked: conversation.summariesEnabled === true }} onPress={() => setThinkingSummaries(conversation.id, !conversation.summariesEnabled)} style={styles.liveRow}><Text style={styles.liveNote}>Thinking summaries · {conversation.summariesEnabled ? "on" : "off"} · next turn</Text></PressScale> : null}
      {targetError ? <Text accessibilityRole="alert" style={styles.targetError}>{targetError}</Text> : null}
      {!targetError && conversation?.openIn ? (
        <Text accessibilityRole="text" style={styles.handoffNote}>
          {sessionViewerLabel(conversation.openIn, conversation.targetHostId, connection)}
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
        <BlurTargetView ref={blurTarget} style={styles.body}><FlashList
          ref={listRef}
          data={messages}
          extraData={external}
          renderItem={({ item }) => <MessageRow message={item} detailMode={conversation?.detailMode ?? "Compact"} harnessId={harnessId} thinking={item.id === latestAssistant?.id ? external : undefined} />}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
          onScrollBeginDrag={() => { dragging.current = true; }}
          onScroll={event => {
            const { contentSize, layoutMeasurement, contentOffset } = event.nativeEvent;
            const moved = Math.abs(contentOffset.y - previousOffset.current) > 1;
            previousOffset.current = contentOffset.y;
            // Web wheel scrolling has no onScrollBeginDrag. A content resize alone
            // must not detach following before onContentSizeChange can scroll.
            if (!moved || (!dragging.current && Platform.OS !== "web")) return;
            setFollow(followsLatest(contentSize.height, layoutMeasurement.height, contentOffset.y));
          }}
          scrollEventThrottle={16}
          onContentSizeChange={scrollToNewest}
          contentContainerStyle={[styles.listContent, thumb.railPadding(44)]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <AgentOrb size={64} thinking={thinking} label={`${harnessName} ${caption}`} />
              <Text style={styles.emptyTitle}>{harnessName}</Text>
              <Text style={styles.emptySubtitle}>
                {online && connection.host ? `on ${connection.host}` : "Ask anything"}
              </Text>
            </View>
          }
        /></BlurTargetView>
        <PromptRail anchors={anchors} following={following} live={Boolean(streamingMessage)} onJump={jumpPrompt}
          onContinue={prompt => { const anchor = anchors[prompt]; if (anchor) navigation.setParams({ draft: `Continue from prompt ${prompt + 1}: ${anchor.text.split("\n")[0]}\nResult: ${anchor.summary}\n\n` }); }}
          onLatest={() => { dragging.current = false; setFollow(true); scrollToNewest(); }} />
      </KeyboardInsetView>}
      <KeyboardDock>
        <View style={styles.liveRow}>
          <PressScale accessibilityRole="button" accessibilityLabel="Choose harness" onPress={() => { haptic.select(); setPickerVisible(true); }} style={styles.liveChip}><Text style={styles.liveChipText}>{harnessName} · Change</Text></PressScale>
          {approvalCount > 0 ? <PressScale accessibilityRole="button" accessibilityLabel={`Review ${approvalCount} approvals${approvalDryRun ? ", preview only" : ""}`} onPress={() => { haptic.select(); navigation.navigate("Approvals"); }} style={styles.approval}><Text style={styles.approvalText}>{approvalCount} approvals{approvalDryRun ? " · preview" : ""} ›</Text></PressScale> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 16, gap: 4 }}>
          <Text style={{ ...type.mono, color: colors.textTertiary, fontSize: 10, marginRight: 6 }}>Thinking & tools</Text>
          {DETAIL_MODES.map(mode => <PressScale key={mode} accessibilityRole="button" accessibilityLabel={`Details ${mode}`} accessibilityState={{ selected: (conversation?.detailMode ?? "Compact") === mode }} onPress={() => { const active = conversation ?? createConversation(harnessId); setDetailMode(active.id, mode); }} style={{ minHeight: 32, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ ...type.mono, fontSize: 11, color: (conversation?.detailMode ?? "Compact") === mode ? colors.gold : colors.textTertiary }}>{mode}</Text></PressScale>)}
        </View>
        <Composer
          key={`${conversation?.id ?? harnessId}:${composerDraft ?? (debugAttachments ? "debug-attachments" : "composer")}`}
          initialAttachments={isDebugActive() ? debugAttachments ?? undefined : undefined}
          disabled={!online || targetError !== undefined || (liveOn && live.status !== "ready")}
          streaming={liveOn ? live.busy : conversation ? conversationBusy(conversation.id) : false}
          steerBusy={canSteer(harnessId, conversation?.sessionId, thinking.phase, liveOn)}
          initialText={composerDraft}
          harness={harnessId}
          blurTarget={liveOn ? undefined : blurTarget}
          cwd={conversation?.cwd}
          placeholder={liveOn ? (live.askHermes ? "Ask Hermes through the live surface" : "Live surface · quick reply") : composerPlaceholder({
            online,
            streaming: Boolean(streamingMessage),
            queued: conversation ? queueLength(conversation.id) : 0,
            openIn: conversation?.openIn,
            harness: harnessId,
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
  approval: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, borderBottomWidth: 1, borderColor: colors.hair },
  approvalText: { ...type.small, color: colors.warn },
  targetError: { color: colors.danger, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  handoffNote: { color: colors.textTertiary, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { flex: 1 },
  listContent: { paddingVertical: space.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: "45%" },
  emptyTitle: { color: colors.text, ...type.title },
  emptySubtitle: { color: colors.textMuted, ...type.body, marginTop: 6 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.xs },
  liveChip: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair, backgroundColor: glass.fillChip, paddingHorizontal: space.md, justifyContent: "center" },
  liveChipOn: { borderColor: colors.gold, backgroundColor: glass.fillChipOn },
  liveChipText: { ...type.label, color: colors.textMuted },
  liveChipTextOn: { color: colors.gold },
  liveNote: { ...type.mono, color: colors.textTertiary, flex: 1 },
});
