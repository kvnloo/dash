import { FlashList } from "@shopify/flash-list";
import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { conversationStreaming, effortIdForTurn, runtimeStateFromOrchestra } from "../catalog/runtime-state";
import { loadVisualCatalog, resolveEffort, resolveProvider, resolveRuntimeState, resolveTopology } from "../catalog/visual";
import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { EffortOrbs } from "../components/EffortOrbs";
import { OrchestraCore, TopologyBadge } from "../components/TopologyBadge";
import { haptic } from "../haptics";
import { projectsFromHosts } from "../lib/project-data";
import type { BotProfile } from "../mock/bots";
import type { ScreenProps } from "../navigation";
import { openBotConversation, setActive, store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { timeAgo } from "../util";

export function OrchestraDetailScreen({ navigation, route }: ScreenProps<"OrchestraDetail">) {
  const insets = useSafeAreaInsets();
  const { orchestraId } = route.params;
  const conversations = store.use((s) => s.conversations);
  const hosts = store.use((s) => s.connection.hosts);
  const cwd = store.use((s) => s.connection.cwd);

  const project = useMemo(() => {
    return (
      projectsFromHosts({ conversations, hosts, cwd, now: Date.now() }).find(
        (p) => p.id === orchestraId,
      ) ?? null
    );
  }, [conversations, hosts, cwd, orchestraId]);

  const linkedChats = useMemo(
    () => conversations.filter((c) => project?.chatIds.includes(c.id)),
    [conversations, project?.chatIds],
  );

  if (!project) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Canvas /><ScreenHeader title="Orchestra" onBack={() => navigation.navigate("Main")} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Project not found</Text>
        </View>
      </View>
    );
  }

  const visual = loadVisualCatalog();
  const topology = resolveTopology(visual, project.topologyId);
  const provider = resolveProvider(visual, project.providerId);
  const streaming = linkedChats.some((c) => conversationStreaming(c.messages));
  const state = resolveRuntimeState(visual, runtimeStateFromOrchestra({ status: project.status, streaming }));
  const effort = resolveEffort(visual, effortIdForTurn({ turnState: streaming ? "streaming" : undefined }));

  const openChat = (id: string) => {
    haptic.select();
    setActive(id);
    navigation.navigate("Chat");
  };

  const openAgent = (profile: BotProfile) => {
    haptic.select();
    const result = openBotConversation(profile);
    if ("error" in result) {
      Alert.alert("Agent unavailable", result.error);
      return;
    }
    navigation.navigate("Chat");
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Canvas /><ScreenHeader title="Orchestra" onBack={() => navigation.navigate("Main")} />
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>{project.name}</Text>
            <Text style={styles.subtitle}>{project.subtitle}</Text>
          </View>
          <EffortOrbs hue={provider.hue} size={48} effort={effort} state={state} accessibilityLabel={`${project.name} · ${state.label}`}>
            <OrchestraCore hue={provider.hue} size={48} />
          </EffortOrbs>
        </View>
        {project.topologyId === "unknown" ? <Text style={{ ...type.mono, color: colors.textTertiary }}>Topology not reported</Text> : <TopologyBadge topologyId={project.topologyId} providerId={project.providerId} width={180} />}
        <View style={styles.metaRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  project.status === "active" ? colors.ok : project.status === "paused" ? colors.warn : colors.textFaint,
              },
            ]}
            accessibilityLabel={project.status}
          />
          <Text style={styles.meta}>
            {topology.label} · {project.agentRows.length} agents · {linkedChats.length} chats
          </Text>
        </View>
      </View>

      <Text style={styles.section}>Agents</Text>
      <FlashList
        data={project.agentRows}
        keyExtractor={(profile) => profile.id}
        scrollEnabled={false}
        ListEmptyComponent={<Text style={styles.emptyChats}>No agents reported for this project</Text>}
        renderItem={({ item: profile }) => {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${profile.name} in ${project.name}`}
              onPress={() => openAgent(profile)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowTitle}>{profile.name}</Text>
              <Text style={styles.rowId}>{profile.online ? profile.harness : "Offline"}</Text>
            </Pressable>
          );
        }}
      />

      <Text style={styles.section}>Chats</Text>
      <FlashList
        data={linkedChats}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        ListEmptyComponent={<Text style={styles.emptyChats}>No linked chats yet</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openChat(item.id)}
            style={({ pressed }) => [styles.chatRow, pressed && styles.pressed]}
          >
            <Text style={styles.chatTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.chatTime}>{timeAgo(item.updatedAt)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  heroCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...type.title },
  subtitle: { color: colors.textTertiary, ...type.mono, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  meta: { color: colors.textFaint, fontSize: 12 },
  section: {
    color: colors.textMuted,
    ...type.section,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: { color: colors.text, ...type.heading, flex: 1 },
  rowId: { color: colors.textFaint, ...type.small, textTransform: "none", letterSpacing: 0 },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatTitle: { color: colors.text, ...type.body, flex: 1, marginRight: space.sm },
  chatTime: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0 },
  pressed: { opacity: 0.85 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textMuted, ...type.body },
  emptyChats: { color: colors.textMuted, ...type.body, paddingHorizontal: space.lg, paddingVertical: space.lg },
});
