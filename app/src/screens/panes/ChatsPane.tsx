import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HarnessAvatar } from "../../components/HarnessAvatar";
import { haptic } from "../../haptics";
import type { Conversation } from "../../model";
import type { ScreenProps } from "../../navigation";
import { deleteConversation, setActive, store } from "../../store/app";
import { colors, space, type } from "../../theme";
import { confirmDestructive, timeAgo } from "../../util";

function preview(c: Conversation): string {
  const last = c.messages[c.messages.length - 1];
  if (!last) return "Empty chat";
  if (last.role === "assistant") {
    const t = last.text.replace(/\s+/g, " ").trim();
    return last.status ? last.status : t || "Thinking…";
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
      <HarnessAvatar name={harnessName} />
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title || harnessName}
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

export function ChatsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const insets = useSafeAreaInsets();
  const conversations = store.use((s) => s.conversations);
  const activeId = store.use((s) => s.activeId);
  const harnesses = store.use((s) => s.connection.harnesses);

  const open = useCallback(
    (id: string) => {
      haptic.select();
      setActive(id);
      navigation.navigate("Chat");
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
    navigation.navigate("Chat");
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
    <View style={styles.wrap}>
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
  wrap: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: { backgroundColor: colors.surface },
  pressed: { opacity: 0.85 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowTitle: { color: colors.text, ...type.heading, flex: 1 },
  rowTime: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0 },
  rowPreview: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text, opacity: 0.7 },
  empty: { paddingTop: "40%", alignItems: "center" },
  emptyText: { color: colors.textMuted, ...type.body },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  newButton: {
    height: 48,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  newPressed: { opacity: 0.9 },
  newText: { color: colors.onAccent, ...type.heading },
});
