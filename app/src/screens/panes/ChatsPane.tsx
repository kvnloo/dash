import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { effortIdForTurn, lastAssistantState, runtimeStateFromTurn } from "../../catalog/runtime-state";
import { HarnessAvatar } from "../../components/HarnessAvatar";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { conversationPreview as preview } from "../../lib/live-sessions";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ConnectionStatus, Conversation } from "../../model";
import type { ScreenProps } from "../../navigation";
import { deleteConversation, setActive, store } from "../../store/app";
import { colors, space, type } from "../../theme";
import { confirmDestructive, dateGroupLabel, timeAgo } from "../../util";

type ChatsListItem =
  | { kind: "section"; id: string; title: string }
  | { kind: "conversation"; id: string; conversation: Conversation };

const Row = memo(function Row({
  item,
  active,
  harnessName,
  connectionStatus,
  onPress,
  onLongPress,
}: {
  item: Conversation;
  active: boolean;
  harnessName: string;
  connectionStatus: ConnectionStatus;
  onPress(id: string): void;
  onLongPress(id: string): void;
}) {
  const turnState = lastAssistantState(item.messages);
  const stateId = runtimeStateFromTurn({ turnState, connectionStatus });
  return (
    <PressScale
      onPress={() => onPress(item.id)}
      onLongPress={() => onLongPress(item.id)}
      delayLongPress={350}
      style={[styles.row, active && styles.rowActive]}
      accessibilityRole="button"
    >
      <HarnessAvatar
        name={harnessName}
        harnessId={item.harness}
        effortId={effortIdForTurn({ turnState })}
        stateId={stateId}
      />
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
    </PressScale>
  );
});

const SectionHeader = memo(function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
});

export function ChatsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const conversations = store.use((s) => s.conversations);
  const activeId = store.use((s) => s.activeId);
  const harnesses = store.use((s) => s.connection.harnesses);
  const connectionStatus = store.use((s) => s.connection.status);

  const items = useMemo((): ChatsListItem[] => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const out: ChatsListItem[] = [];
    let lastGroup = "";
    for (const c of sorted) {
      const group = dateGroupLabel(c.updatedAt);
      if (group !== lastGroup) {
        out.push({ kind: "section", id: `sec-${group}`, title: group });
        lastGroup = group;
      }
      out.push({ kind: "conversation", id: c.id, conversation: c });
    }
    return out;
  }, [conversations]);

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

  const onFeedback = useCallback(
    (id: string) => {
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      const conversation = store.get().conversations.find((c) => c.id === id);
      haptic.select();
      submitInAppFeedback({
        kind: "select",
        text: `Selected chat ${conversation?.title ?? id}`,
        selection: { kind: "chat", id, label: conversation?.title || id },
      });
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const feedbackOn = inAppFeedbackEnabled(store.use((s) => s.settings));

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatsListItem>) => {
      if (item.kind === "section") return <SectionHeader title={item.title} />;
      const c = item.conversation;
      return (
        <Row
          item={c}
          active={c.id === activeId}
          harnessName={harnesses.find((h) => h.id === c.harness)?.name ?? c.harness}
          connectionStatus={connectionStatus}
          onPress={open}
          onLongPress={feedbackOn ? onFeedback : remove}
        />
      );
    },
    [activeId, connectionStatus, feedbackOn, harnesses, onFeedback, open, remove],
  );

  const getItemType = useCallback((item: ChatsListItem) => item.kind, []);

  return (
    <View style={styles.wrap}>
      <FlashList
        data={items}
        renderItem={renderItem}
        getItemType={getItemType}
        keyExtractor={(item) => item.id}
        extraData={`${activeId}:${connectionStatus}`}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No chats yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  section: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  sectionTitle: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0, fontWeight: "600" },
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
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowTitle: { color: colors.text, ...type.heading, flex: 1 },
  rowTime: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0 },
  rowPreview: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  empty: { paddingTop: "40%", alignItems: "center" },
  emptyText: { color: colors.textMuted, ...type.body },
});
