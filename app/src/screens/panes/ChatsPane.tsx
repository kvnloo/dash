import { useHandedness } from "../../lib/useHandedness";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { chatAttention, chatPriority } from "../../lib/chat-attention";
import { threadAppearance } from "../../components/thread-appearance";
import { AgentOrb } from "../../components/AgentOrb";
import { conversationThinking } from "../../lib/thinking";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { chatRow } from "../../lib/chat-row";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ConnectionStatus, Conversation } from "../../model";
import type { ScreenProps } from "../../navigation";
import { clearEndedConversations, deleteConversation, setActive, store } from "../../store/app";
import { colors, space, type } from "../../theme";
import { confirmDestructive, dateGroupLabel, timeAgo } from "../../util";

type ChatsListItem =
  | { kind: "section"; id: string; title: string; count: number }
  | { kind: "conversation"; id: string; conversation: Conversation };

const Row = memo(function Row({
  item,
  active,
  harnessName,
  connectionStatus,
  live = false,
  onPress,
  onLongPress,
}: {
  item: Conversation & { stale?: boolean };
  active: boolean;
  harnessName: string;
  connectionStatus: ConnectionStatus;
  live?: boolean;
  onPress(id: string): void;
  onLongPress(id: string): void;
}) {
  const appearance = threadAppearance({ stale: item.stale, live });
  const stale = appearance.stale;
  // What the agent is doing now, as a thinking-orbs orb (idle orbs hold still).
  const thinking = item.stale ? { phase: "idle" as const } : conversationThinking(item.messages, connectionStatus);
  const content = useMemo(() => chatRow(item, harnessName, connectionStatus), [item, harnessName, connectionStatus]);
  return (
    <PressScale
      onPress={() => onPress(item.id)}
      onLongPress={() => onLongPress(item.id)}
      delayLongPress={350}
      style={[styles.row, active && !stale && styles.rowActive]}
      accessibilityRole="button"
      testID={`chat-row-${item.id}`}
    >
      <AgentOrb size={28} thinking={thinking} label={`${harnessName} · ${thinking.tool ?? thinking.phase}`} />
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, stale && styles.stale]} numberOfLines={1}>
            {content.title}
          </Text>
          {appearance.live && connectionStatus === "online" ? <View accessibilityLabel="Live on host" style={styles.liveDot} /> : null}
          <Text style={styles.rowTime} numberOfLines={1}>{stale ? "ended" : item.openIn ? `${item.openIn} · ${timeAgo(item.updatedAt)}` : timeAgo(item.updatedAt)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.rowFolder} numberOfLines={1} accessibilityLabel={content.folderPath ? `Working folder: ${content.folderPath}` : content.folder}>
            {content.folder}
          </Text>
          <Text style={[styles.rowActivity, content.needsAttention && styles.attention]} numberOfLines={1}>
            {content.activity}
          </Text>
        </View>
        {content.outcomeLabel ? <Text style={styles.rowLabel}>{content.outcomeLabel}</Text> : null}
        <Text style={[styles.rowPreview, stale && styles.stale]} numberOfLines={2}>
          {content.outcome}
        </Text>
      </View>
      <View style={styles.hairline} />
    </PressScale>
  );
});

const SectionHeader = memo(function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text><Text style={styles.rowTime}>{count}</Text>
    </View>
  );
});

export function ChatsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const thumb = useHandedness();
  const conversations = store.use((s) => s.conversations);
  const activeId = store.use((s) => s.activeId);
  const harnesses = store.use((s) => s.connection.harnesses);
  const connectionStatus = store.use((s) => s.connection.status);
  const hosts = store.use((s) => s.connection.hosts);

  const items = useMemo((): ChatsListItem[] => {
    const sorted = [...conversations].sort((a, b) => chatPriority(a) - chatPriority(b) || b.updatedAt - a.updatedAt);
    const out: ChatsListItem[] = [];
    let lastGroup = "";
    for (const c of sorted) {
      const group = chatAttention(c) ?? (c.stale ? "Ended" : dateGroupLabel(c.updatedAt));
      if (group !== lastGroup) {
        out.push({ kind: "section", id: `sec-${group}`, title: group, count: sorted.filter(item => (chatAttention(item) ?? (item.stale ? "Ended" : dateGroupLabel(item.updatedAt))) === group).length });
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
      if (item.kind === "section") return <SectionHeader title={item.title} count={item.count} />;
      const c = item.conversation;
      return (
        <Row
          item={c}
          active={c.id === activeId}
          harnessName={harnesses.find((h) => h.id === c.harness)?.name ?? c.harness}
          connectionStatus={connectionStatus}
          live={Boolean(c.sessionId && hosts.some(host => host.online && (!c.targetHostId || host.id === c.targetHostId) && host.agents.some(agent => agent.sessionId === c.sessionId && agent.kind === c.harness && agent.status === "running")))}
          onPress={open}
          onLongPress={feedbackOn ? onFeedback : remove}
        />
      );
    },
    [activeId, conversations, connectionStatus, feedbackOn, harnesses, hosts, onFeedback, open, remove],
  );

  const getItemType = useCallback((item: ChatsListItem) => item.kind, []);

  return (
    <View style={styles.wrap} testID="chats-pane">
      {conversations.some(c => c.stale) && (
        <PressScale onPress={() => confirmDestructive("Clear ended chats?", "Saved history is removed from this phone only.", "Clear ended", clearEndedConversations)} accessibilityRole="button" style={[styles.clearEnded, thumb.align]}>
          <Text style={styles.clearEndedText}>Clear ended</Text>
        </PressScale>
      )}
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  sectionTitle: { color: colors.textMuted, ...type.label },
  attention: { color: colors.danger },
  clearEnded: { paddingHorizontal: space.lg, paddingTop: space.sm, minHeight: 44, justifyContent: "center" },
  clearEndedText: { color: colors.gold, ...type.label },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: 68,
    paddingVertical: 10,

  },
  rowActive: { backgroundColor: "rgba(215,185,134,.035)" },
  stale: { color: colors.textTertiary },
  liveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold },
  // PressScale applies padding on its outer Pressable and lays children out in an inner view,
  // so the divider must sit below that padding, not on the inner view's bottom edge.
  hairline: { position: "absolute", left: 52, right: 0, bottom: -10, height: StyleSheet.hairlineWidth, backgroundColor: colors.hair },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowTitle: { color: colors.text, ...type.heading, flex: 1 },
  rowTime: { color: colors.textTertiary, ...type.mono, textTransform: "none", letterSpacing: 0 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  rowFolder: { color: colors.goldLo, ...type.mono, flex: 1, minWidth: 0 },
  rowActivity: { color: colors.textTertiary, ...type.label, flexShrink: 1, maxWidth: "55%" },
  rowLabel: { color: colors.textTertiary, ...type.label, marginTop: space.xs },
  rowPreview: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  empty: { paddingTop: "40%", alignItems: "center" },
  emptyText: { color: colors.textMuted, ...type.body },
});
