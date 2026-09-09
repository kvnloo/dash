import { Ionicons } from "@expo/vector-icons";
import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "../components/Composer";
import { ConnectionPill } from "../components/ConnectionPill";
import { HarnessPicker } from "../components/HarnessPicker";
import { Header, IconButton } from "../components/Header";
import { GlassSurface } from "../components/GlassSurface";
import { MessageRow } from "../components/MessageRow";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import type { Message } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge, sendChat } from "../net/bridge";
import {
  applyTurnEvent,
  beginTurn,
  conversationBusy,
  createConversation,
  promotePendingTurn,
  saveSettings,
  setActive,
  store,
} from "../store/app";
import { dequeue, enqueue, notifyTurnSettled, onTurnSettled, queueLength } from "../store/queue";
import { colors, radius, space, type } from "../theme";

const EMPTY: Message[] = [];

function keyExtractor(item: Message): string {
  return item.id;
}

function getItemType(item: Message): string {
  return item.role;
}

function renderItem({ item }: ListRenderItemInfo<Message>) {
  return <MessageRow message={item} />;
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

  const streamingMessage = useMemo(() => {
    const last = messages[messages.length - 1];
    return last?.role === "assistant" && last.state === "streaming" ? last : undefined;
  }, [messages]);

  const sendTurn = useCallback(
    (text: string, active = conversation ?? createConversation(harnessId)) => {
      const { turnId } = beginTurn(active.id, text);
      haptic.tap();
      const ok = sendChat({
        turnId,
        harness: active.harness,
        text,
        sessionId: store.get().conversations.find((c) => c.id === active.id)?.sessionId ?? active.sessionId,
      });
      if (!ok) {
        applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Not connected to the bridge." });
        haptic.error();
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
      const ok = sendChat({
        turnId,
        harness: payload.harness,
        text: payload.text,
        sessionId: store.get().conversations.find((c) => c.id === conversationId)?.sessionId ?? payload.sessionId,
      });
      if (!ok) {
        applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Not connected to the bridge." });
        haptic.error();
        notifyTurnSettled(conversationId);
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

  const onStop = useCallback(() => {
    if (streamingMessage) bridge.send({ type: "cancel", id: streamingMessage.turnId });
  }, [streamingMessage]);

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

  const newChat = useCallback(() => {
    haptic.select();
    setActive(null);
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        left={<IconButton icon="chevron-back" label="Back" onPress={() => navigation.navigate("Main")} />}
        center={
          <Pressable
            onPress={() => setPickerVisible(true)}
            style={({ pressed }) => [pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Harness: ${harnessName}. Change`}
          >
            <GlassSurface variant="chip" blur={false} borderRadius={radius.pill} style={styles.titleButton}>
              <Text style={styles.title} numberOfLines={1}>
                {harnessName}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            </GlassSurface>
          </Pressable>
        }
        right={
          <View style={styles.headerActions}>
            <IconButton icon="options-outline" label="Settings" onPress={() => navigation.navigate("Settings")} />
            <IconButton icon="create-outline" label="New chat" onPress={newChat} />
          </View>
        }
      />
      <ConnectionPill />
      <KeyboardAvoidingView style={styles.body} behavior="padding" keyboardVerticalOffset={insets.bottom}>
        <FlashList
          ref={listRef}
          data={messages}
          renderItem={renderItem}
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
        <View style={{ paddingBottom: Math.max(insets.bottom, space.sm) }}>
          <Composer
            key={composerDraft ?? "composer"}
            disabled={!online}
            streaming={streamingMessage !== undefined}
            initialText={composerDraft}
            placeholder={
              online
                ? streamingMessage
                  ? conversation && queueLength(conversation.id) > 0
                    ? `Queue another (${queueLength(conversation.id)} waiting)…`
                    : `Queue next message for ${harnessName}…`
                  : `Message ${harnessName}`
                : "Waiting for the bridge…"
            }
            onSend={onSend}
            onStop={onStop}
          />
        </View>
      </KeyboardAvoidingView>
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
  body: { flex: 1 },
  listContent: { paddingVertical: space.sm },
  titleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  pressed: { opacity: 0.85 },
  title: { color: colors.text, ...type.heading },
  headerActions: { flexDirection: "row", alignItems: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: "45%" },
  emptyTitle: { color: colors.text, ...type.title, fontSize: 28 },
  emptySubtitle: { color: colors.textMuted, ...type.body, marginTop: 6 },
});
