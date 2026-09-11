import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HarnessAvatar } from "../components/HarnessAvatar";
import { AppNav } from "../components/AppNav";
import { haptic } from "../haptics";
import type { Conversation } from "../model";
import type { ScreenProps } from "../navigation";
import { deleteConversation, setActive, store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { confirmDestructive, timeAgo } from "../util";

function preview(c: Conversation): string {
  const last = c.messages[c.messages.length - 1];
  if (!last) return c.cwd ?? (c.sessionId ? c.title : "Empty chat");
  if (last.role === "assistant") {
    if (last.state === "streaming") return last.status ? `Working: ${last.status}` : "Working…";
    if (last.state === "error") return last.error ?? "Error";
    return last.text.replace(/\s+/g, " ").trim() || "…";
  }
  return last.text.replace(/\s+/g, " ").trim();
}

const Row = memo(function Row({
  item,
  active,
  harnessName,
  onPress,
  onDelete,
}: {
  item: Conversation;
  active: boolean;
  harnessName: string;
  onPress(id: string): void;
  onDelete(id: string): void;
}) {
  const streaming = item.messages.some((m) => m.role === "assistant" && m.state === "streaming");
  return (
    <Pressable
      onPress={() => onPress(item.id)}
      onLongPress={() => onDelete(item.id)}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <HarnessAvatar name={harnessName} harnessId={item.harness} />
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {harnessName}
          </Text>
          <Text style={styles.rowTime}>{timeAgo(item.updatedAt)}</Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {preview(item)}
        </Text>
      </View>
      {streaming ? <View style={styles.dot} /> : null}
    </Pressable>
  );
});

export function ConversationsScreen({ navigation }: ScreenProps<"Conversations">) {
  const insets = useSafeAreaInsets();
  const conversations = store.use((s) => s.conversations);
  const activeId = store.use((s) => s.activeId);
  const harnesses = store.use((s) => s.connection.harnesses);

  const open = useCallback(
    (id: string) => {
      haptic.select();
      setActive(id);
      navigation.goBack();
    },
    [navigation],
  );

  const remove = useCallback((id: string) => {
    confirmDestructive("Delete chat?", "This removes it from this phone only.", "Delete", () => {
      deleteConversation(id);
    });
  }, []);

  const newChat = useCallback(() => {
    haptic.tap();
    setActive(null);
    navigation.goBack();
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Conversation>) => (
      <Row
        item={item}
        active={item.id === activeId}
        harnessName={harnesses.find((h) => h.id === item.harness)?.name ?? item.harness}
        onPress={open}
        onDelete={remove}
      />
    ),
    [activeId, harnesses, open, remove],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AppNav navigation={navigation} tab={1} />
      <FlashList
        data={conversations}
        renderItem={renderItem}
        keyExtractor={(c) => c.id}
        extraData={activeId}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No chats yet</Text>
          </View>
        }
      />
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]} pointerEvents="box-none">
        <Pressable
          onPress={newChat}
          style={({ pressed }) => [styles.newButton, pressed && styles.newPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.newText}>New chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: { backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.surfaceRaised },
  rowMain: { flex: 1, gap: 3, marginLeft: 14 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  rowTitle: { flex: 1, color: colors.text, ...type.heading },
  rowTime: { color: colors.textFaint, ...type.small },
  rowPreview: { color: colors.textMuted, ...type.small },
  rowHarness: { color: colors.textFaint },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text, marginLeft: space.md },
  empty: { alignItems: "center", paddingTop: "40%" },
  emptyText: { color: colors.textMuted, ...type.body },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingTop: space.lg },
  newButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 28,
    paddingVertical: 15,
    borderRadius: radius.pill,
  },
  newPressed: { opacity: 0.8 },
  newText: { color: colors.onAccent, ...type.heading },
});
