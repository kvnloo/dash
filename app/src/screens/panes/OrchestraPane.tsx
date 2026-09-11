import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { conversationStreaming, effortIdForTurn, runtimeStateFromOrchestra } from "../../catalog/runtime-state";
import { loadAodlOrchestras, type OrchestraProject } from "../../catalog/orchestra";
import { loadVisualCatalog, resolveEffort, resolveProvider, resolveRuntimeState, resolveTopology } from "../../catalog/visual";
import { EffortOrbs } from "../../components/EffortOrbs";
import { OrchestraCore, TopologyBadge } from "../../components/TopologyBadge";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { enrichProducts } from "../../lib/global-search";
import type { ScreenProps } from "../../navigation";
import { store } from "../../store/app";
import { colors, radius, space, type } from "../../theme";
import { timeAgo } from "../../util";

const Card = memo(function Card({
  item,
  streaming,
  onPress,
}: {
  item: OrchestraProject;
  streaming: boolean;
  onPress(id: string): void;
}) {
  const visual = loadVisualCatalog();
  const topology = resolveTopology(visual, item.topologyId);
  const provider = resolveProvider(visual, item.providerId);
  const state = resolveRuntimeState(visual, runtimeStateFromOrchestra({ status: item.status, streaming }));
  const effort = resolveEffort(visual, effortIdForTurn({ turnState: streaming ? "streaming" : undefined }));
  return (
    <PressScale onPress={() => onPress(item.id)} style={styles.card} accessibilityRole="button">
      <View style={styles.cardTop}>
        <View style={styles.cardTitles}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {item.subtitle}
          </Text>
        </View>
        <EffortOrbs hue={provider.hue} size={36} effort={effort} state={state} accessibilityLabel={`${item.name} · ${state.label}`}>
          <OrchestraCore hue={provider.hue} size={36} />
        </EffortOrbs>
      </View>
      <TopologyBadge topologyId={item.topologyId} providerId={item.providerId} width={220} />
      <View style={styles.footer}>
        <Text style={styles.meta}>
          {topology.label} · {item.agents.length} agent{item.agents.length === 1 ? "" : "s"} · {item.chatIds.length} chat
          {item.chatIds.length === 1 ? "" : "s"}
        </Text>
        <Text style={styles.time}>{timeAgo(item.updatedAt)}</Text>
      </View>
    </PressScale>
  );
});

export function OrchestraPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const conversations = store.use((s) => s.conversations);
  const projects = useMemo(() => {
    return enrichProducts(conversations, loadAodlOrchestras());
  }, [conversations]);
  const streamingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conversation of conversations) {
      if (conversationStreaming(conversation.messages)) ids.add(conversation.id);
    }
    return ids;
  }, [conversations]);

  const open = useCallback(
    (id: string) => {
      haptic.select();
      navigation.navigate("OrchestraDetail", { orchestraId: id });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<OrchestraProject>) => {
      const streaming = item.chatIds.some((id) => streamingIds.has(id));
      return <Card item={item} streaming={streaming} onPress={open} />;
    },
    [open, streamingIds],
  );

  return (
    <FlashList
      data={projects}
      renderItem={renderItem}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No orchestras</Text>
          <Text style={styles.emptySub}>Projects will appear when agents and chats are linked.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 120 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  cardTitles: { flex: 1, minWidth: 0 },
  name: { color: colors.text, ...type.heading },
  sub: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: space.md },
  meta: { color: colors.textFaint, fontSize: 12, flex: 1, marginRight: space.sm },
  time: { color: colors.textFaint, fontSize: 12 },
  empty: { paddingTop: "35%", paddingHorizontal: space.xl, alignItems: "center" },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
