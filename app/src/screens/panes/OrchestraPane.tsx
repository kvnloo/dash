import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { conversationStreaming, effortIdForTurn, runtimeStateFromOrchestra } from "../../catalog/runtime-state";
import { loadVisualCatalog, resolveEffort, resolveProvider, resolveRuntimeState, resolveTopology } from "../../catalog/visual";
import { GlassSurface } from "../../components/GlassSurface";
import { EffortOrbs } from "../../components/EffortOrbs";
import { OrchestraCore, TopologyBadge } from "../../components/TopologyBadge";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import { projectsFromHosts, type LiveProject } from "../../lib/project-data";
import { threadTargetForOrchestra } from "../../lib/orchestra-thread";
import type { ScreenProps } from "../../navigation";
import { setActive, store } from "../../store/app";
import { colors, radius, space, type } from "../../theme";
import { timeAgo } from "../../util";
import { orchestraMap } from "../../lib/orchestra-map";
import { debugUi } from "../../debug/ui-store";
import { isDebugActive } from "../../debug/expose";
import { orchestraMotionFixture } from "../../debug/orchestra-fixture";
import { OrchestraGraph } from "../../components/OrchestraGraph";
import { WorkspaceActions } from "../../components/WorkspaceHeader";

const Card = memo(function Card({
  item,
  streaming,
  onPress,
  onLongPress,
}: {
  item: LiveProject;
  streaming: boolean;
  onPress(item: LiveProject): void;
  onLongPress?(item: LiveProject): void;
}) {
  const visual = loadVisualCatalog();
  const topology = resolveTopology(visual, item.topologyId);
  const provider = resolveProvider(visual, item.providerId);
  const state = resolveRuntimeState(visual, runtimeStateFromOrchestra({ status: item.status, streaming }));
  const effort = resolveEffort(visual, effortIdForTurn({ turnState: streaming ? "streaming" : undefined }));
  return (
    <PressScale
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}
      style={styles.card}
      accessibilityRole="button"
    >
      <GlassSurface borderRadius={14} style={{ alignSelf: "stretch" }} contentStyle={{ padding: 16 }}>
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
      {/* No topology is claimed until a host reports one: no placeholder diagram or label. */}
      {item.topologyId === "unknown" ? null : <TopologyBadge topologyId={item.topologyId} providerId={item.providerId} width={180} />}
      <View style={styles.footer}>
        <Text style={styles.meta} numberOfLines={1}>
          {[item.topologyId === "unknown" ? undefined : topology.label, `${item.agentRows.length} agent${item.agentRows.length === 1 ? "" : "s"}`, `${item.chatIds.length} chat${item.chatIds.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        </Text>
        <Text style={styles.time}>{timeAgo(item.updatedAt)}</Text>
      </View>
      </GlassSurface>
    </PressScale>
  );
});

export function OrchestraPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const conversations = store.use((s) => s.conversations);
  const settings = store.use((s) => s.settings);
  const hosts = store.use((s) => s.connection.hosts);
  const cwd = store.use((s) => s.connection.cwd);
  const projects = useMemo(() => {
    return projectsFromHosts({ conversations, hosts, cwd, now: Date.now() });
  }, [conversations, hosts, cwd]);
  const streamingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conversation of conversations) {
      if (conversationStreaming(conversation.messages)) ids.add(conversation.id);
    }
    return ids;
  }, [conversations]);

  const open = useCallback(
    (item: LiveProject) => {
      haptic.select();
      const linked = store.get().conversations.filter((conversation) => item.chatIds.includes(conversation.id));
      const target = threadTargetForOrchestra(item, linked);
      if (target.kind === "chat") {
        setActive(target.conversationId);
        navigation.navigate("Chat");
        return;
      }
      navigation.navigate("OrchestraDetail", { orchestraId: target.orchestraId });
    },
    [navigation],
  );

  const onFeedback = useCallback(
    (item: LiveProject) => {
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      haptic.select();
      submitInAppFeedback({
        kind: "select",
        text: `Selected orchestra ${item.name}`,
        selection: { kind: "orchestra", id: item.id, label: item.name },
      });
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const feedbackOn = inAppFeedbackEnabled(settings);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LiveProject>) => {
      const streaming = item.chatIds.some((id) => streamingIds.has(id));
      return <Card item={item} streaming={streaming} onPress={open} onLongPress={feedbackOn ? onFeedback : undefined} />;
    },
    [feedbackOn, onFeedback, open, streamingIds],
  );

  const { width } = useWindowDimensions();
  const fixture = debugUi.use(s => s.orchestraFixture);
  const fixtureOn = isDebugActive() && fixture === true;
  const graph = useMemo(() => fixtureOn ? orchestraMotionFixture() : orchestraMap(hosts, conversations), [hosts, conversations, fixtureOn]);
  return (
    <OrchestraGraph graph={graph} width={width} fixture={fixtureOn} actions={<WorkspaceActions navigation={navigation} />}>
    <View style={styles.projects}>
    <FlashList
      data={projects}
      renderItem={renderItem}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No orchestras</Text>
          <Text style={styles.emptySub}>Projects appear when the bridge reports an agent working directory or a chat has one.</Text>
        </View>
      }
    />
    </View>
    </OrchestraGraph>
  );
}

const styles = StyleSheet.create({
  projects: { height: 136 },
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
  card: {
    borderRadius: 14,
    alignItems: "stretch",
    marginBottom: space.md,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  cardTitles: { flex: 1, minWidth: 0 },
  name: { color: colors.text, ...type.cardTitle },
  sub: { color: colors.textTertiary, ...type.mono, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: space.md },
  meta: { color: colors.textTertiary, ...type.small, flex: 1, marginRight: space.sm },
  time: { color: colors.textTertiary, ...type.mono },
  empty: { paddingTop: "35%", paddingHorizontal: space.xl, alignItems: "center" },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
