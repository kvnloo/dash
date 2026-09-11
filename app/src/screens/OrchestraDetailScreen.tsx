import { FlashList } from "@shopify/flash-list";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HarnessAvatar } from "../components/HarnessAvatar";
import { AppNav } from "../components/AppNav";
import { haptic } from "../haptics";
import { loadAodlOrchestras } from "../catalog/orchestra";
import { enrichProducts } from "../lib/global-search";
import type { ScreenProps } from "../navigation";
import { setActive, store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { timeAgo } from "../util";

export function OrchestraDetailScreen({ navigation, route }: ScreenProps<"OrchestraDetail">) {
  const insets = useSafeAreaInsets();
  const { orchestraId } = route.params;
  const harnesses = store.use((s) => s.connection.harnesses);
  const conversations = store.use((s) => s.conversations);

  const project = useMemo(() => {
    return enrichProducts(conversations, loadAodlOrchestras()).find((p) => p.id === orchestraId) ?? null;
  }, [conversations, orchestraId]);

  const linkedChats = useMemo(
    () => conversations.filter((c) => project?.chatIds.includes(c.id)),
    [conversations, project?.chatIds],
  );

  if (!project) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <AppNav navigation={navigation} tab={2} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Project not found</Text>
        </View>
      </View>
    );
  }

  const openChat = (id: string) => {
    haptic.select();
    setActive(id);
    navigation.navigate("Chat");
  };

  const openAgent = (harnessId: string) => {
    haptic.select();
    const chat = linkedChats.find((c) => c.harness === harnessId);
    if (chat) openChat(chat.id);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AppNav navigation={navigation} tab={2} />
      <View style={styles.hero}>
        <Text style={styles.title}>{project.name}</Text>
        <Text style={styles.subtitle}>{project.subtitle}</Text>
        <View style={styles.metaRow}>
          <View
            style={[styles.statusDot, { backgroundColor: project.status === "active" ? colors.ok : project.status === "paused" ? colors.warn : colors.textFaint }]}
            accessibilityLabel={project.status}
          />
          <Text style={styles.meta}>
            {project.agents.length} agents · {linkedChats.length} chats
          </Text>
        </View>
      </View>

      <Text style={styles.section}>Agents</Text>
      <FlashList
        data={project.agents}
        keyExtractor={(id) => id}
        scrollEnabled={false}
        renderItem={({ item: harnessId }) => {
          const name = harnesses.find((h) => h.id === harnessId)?.name ?? harnessId;
          return (
            <Pressable
              onPress={() => openAgent(harnessId)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <HarnessAvatar name={name} size={40} />
              <Text style={styles.rowTitle}>{name}</Text>
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
  hero: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  title: { color: colors.text, ...type.heading },
  subtitle: { color: colors.textMuted, ...type.body, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  meta: { color: colors.textFaint, fontSize: 12 },
  section: {
    color: colors.textMuted,
    ...type.small,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: { color: colors.text, ...type.heading },
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
