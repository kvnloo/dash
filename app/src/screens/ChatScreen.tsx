import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "../components/Composer";
import { composerPlaceholder } from "./composer-placeholder";
import { KeyboardDock } from "../components/KeyboardDock";
import { ConnectionPill } from "../components/ConnectionPill";
import { HarnessPicker } from "../components/HarnessPicker";
import { AppNav } from "../components/AppNav";
import { MessageRow } from "../components/MessageRow";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import type { Message } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge, sendChat } from "../net/bridge";
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
import { colors, space, type } from "../theme";

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
  const debugPicker = debugUi.use((s) => s.chatHarnessPickerOpen);
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
  const harnessId = conversation?.harness ?? settings?.harness ?? "omp";
  const harness = connection.harnesses.find((h) => h.id === harnessId);
  const harnessName = harness?.name ?? harnessId;
  const online = connection.status === "online";
  const targetError = conversation ? conversationTargetError(conversation) : undefined;

  const streamingMessage = useMemo(() => {
    return messages.find((m) => m.role === "assistant" && m.state === "streaming");
  }, [messages]);

  const sendTurn = useCallback(
    (text: string, active = conversation ?? createConversation(harnessId)) => {
      const { turnId } = beginTurn(active.id, text);
      haptic.tap();
      const current = store.get().conversations.find((c) => c.id === active.id) ?? active;
      const ok = sendChat({
        turnId,
        harness: current.harness,
        text,
        sessionId: current.sessionId,
        cwd: current.cwd,
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
    (text: string) => {
      const active = conversation ?? createConversation(harnessId);
      if (conversationBusy(active.id)) {
        const { turnId } = beginTurn(active.id, text, { pending: true });
        enqueue(active.id, turnId);
        haptic.tap();
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      sendTurn(text, active);
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
      <ScreenHeader compact title={conversation?.title || harnessName} onBack={() => navigation.navigate("Main", { tab: 1 })} action="Choose harness" icon="sliders" onAction={() => setPickerVisible(true)} />
      <ConnectionPill />
      {targetError ? <Text accessibilityRole="alert" style={styles.targetError}>{targetError}</Text> : null}
      {!targetError && conversation?.openIn ? (
        <Text accessibilityRole="text" style={styles.handoffNote}>
          Open in {conversation.openIn} on {connection.hosts.find((h) => h.id === conversation.targetHostId)?.name ?? connection.host ?? "the host"}. Replies wait until it closes there.
        </Text>
      ) : null}
      <View style={styles.body}>
        <FlashList
          ref={listRef}
          data={messages}
          renderItem={(info) => renderItem(info, harnessId)}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{harnessName}</Text>
              <Text style={styles.emptySubtitle}>
                {online && connection.host ? `on ${connection.host}` : "Ask anything"}
              </Text>
            </View>
          }
        />
      </View>
      <KeyboardDock>
        <Composer
          key={composerDraft ?? "composer"}
          disabled={!online || targetError !== undefined}
          streaming={conversation ? conversationBusy(conversation.id) : false}
          initialText={composerDraft}
          placeholder={composerPlaceholder({
            online,
            streaming: Boolean(streamingMessage),
            queued: conversation ? queueLength(conversation.id) : 0,
            openIn: conversation?.openIn,
            harnessName,
          })}
          onSend={onSend}
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
  listContent: { paddingVertical: space.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: "45%" },
  emptyTitle: { color: colors.text, ...type.title },
  emptySubtitle: { color: colors.textMuted, ...type.body, marginTop: 6 },
});
