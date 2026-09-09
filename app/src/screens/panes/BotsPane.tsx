import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HarnessAvatar } from "../../components/HarnessAvatar";
import { haptic } from "../../haptics";
import type { ScreenProps } from "../../navigation";
import { createConversation, saveSettings, setActive, store } from "../../store/app";
import { colors, radius, space, type } from "../../theme";

const TAGLINES: Record<string, string> = {
  omp: "OMP on your laptop",
  codex: "OpenAI Codex CLI",
  grok: "xAI Grok agent",
  hermes: "Hermes profiles & mesh",
  claude: "Anthropic Claude Code",
};

const Row = memo(function Row({
  id,
  name,
  available,
  chatCount,
  onPress,
}: {
  id: string;
  name: string;
  available: boolean;
  chatCount: number;
  onPress(id: string): void;
}) {
  const tagline = TAGLINES[id] ?? "Coding agent";
  return (
    <Pressable
      onPress={() => onPress(id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <HarnessAvatar name={name} size={52} />
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <View style={[styles.badge, !available && styles.badgeOff]}>
            <Text style={[styles.badgeText, !available && styles.badgeTextOff]}>
              {available ? "Online" : "Offline"}
            </Text>
          </View>
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {tagline}
        </Text>
        {chatCount > 0 ? (
          <Text style={styles.meta}>
            {chatCount} chat{chatCount === 1 ? "" : "s"}
          </Text>
        ) : (
          <Text style={styles.meta}>Tap to start chatting</Text>
        )}
      </View>
    </Pressable>
  );
});

export function BotsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const harnesses = store.use((s) => s.connection.harnesses);
  const conversations = store.use((s) => s.conversations);
  const settings = store.use((s) => s.settings);

  const openBot = useCallback(
    (harnessId: string) => {
      haptic.select();
      if (settings) saveSettings({ ...settings, harness: harnessId });
      const existing = conversations.find((c) => c.harness === harnessId);
      if (existing) {
        setActive(existing.id);
      } else {
        createConversation(harnessId);
      }
      navigation.navigate("Chat");
    },
    [conversations, navigation, settings],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<(typeof harnesses)[number]>) => {
      const chatCount = conversations.filter((c) => c.harness === item.id).length;
      return (
        <Row
          id={item.id}
          name={item.name}
          available={item.available}
          chatCount={chatCount}
          onPress={openBot}
        />
      );
    },
    [conversations, openBot],
  );

  return (
    <FlashList
      data={harnesses}
      renderItem={renderItem}
      keyExtractor={(h) => h.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No agents yet</Text>
          <Text style={styles.emptySub}>Connect to your bridge to load harness profiles.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 120 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
  },
  pressed: { opacity: 0.85 },
  main: { flex: 1, minWidth: 0 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { color: colors.text, ...type.heading, flex: 1 },
  badge: {
    backgroundColor: "rgba(52,199,89,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeOff: { backgroundColor: colors.surfaceRaised },
  badgeText: { color: colors.ok, fontSize: 11, fontWeight: "600" },
  badgeTextOff: { color: colors.textMuted },
  sub: { color: colors.textMuted, ...type.small, marginTop: 4, textTransform: "none", letterSpacing: 0 },
  meta: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  empty: { paddingTop: "40%", paddingHorizontal: space.xl, alignItems: "center" },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
