import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HarnessAvatar } from "../../components/HarnessAvatar";
import { haptic } from "../../haptics";
import { DEMO_BOT_PROFILES, type BotProfile } from "../../mock/bots";
import type { ScreenProps } from "../../navigation";
import { createConversation, saveSettings, setActive, store } from "../../store/app";
import { colors, space, type } from "../../theme";

type BotsListItem =
  | { kind: "section"; id: string; title: string; online: boolean }
  | { kind: "profile"; id: string; profile: BotProfile };

const ProfileRow = memo(function ProfileRow({
  profile,
  onPress,
}: {
  profile: BotProfile;
  onPress(profile: BotProfile): void;
}) {
  return (
    <Pressable
      onPress={() => onPress(profile)}
      style={({ pressed }) => [styles.profileCard, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <HarnessAvatar name={profile.name} size={44} />
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {profile.name}
          </Text>
          <View style={[styles.statusDot, profile.online ? styles.statusOn : styles.statusOff]} />
        </View>
        <Text style={styles.role} numberOfLines={1}>
          {profile.role}
        </Text>
        <Text style={styles.desc} numberOfLines={2}>
          {profile.description}
        </Text>
      </View>
    </Pressable>
  );
});

const SectionHeader = memo(function SectionHeader({ title, online }: { title: string; online: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={[styles.statusDot, online ? styles.statusOn : styles.statusOff]} />
    </View>
  );
});

export function BotsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const harnesses = store.use((s) => s.connection.harnesses);
  const conversations = store.use((s) => s.conversations);
  const settings = store.use((s) => s.settings);

  const items = useMemo((): BotsListItem[] => {
    const out: BotsListItem[] = [];
    for (const h of harnesses) {
      const profiles = DEMO_BOT_PROFILES.filter((p) => p.harness === h.id);
      if (profiles.length === 0) continue;
      out.push({ kind: "section", id: `sec-${h.id}`, title: h.name, online: h.available });
      for (const profile of profiles) {
        out.push({ kind: "profile", id: profile.id, profile });
      }
    }
    return out;
  }, [harnesses]);

  const openProfile = useCallback(
    (profile: BotProfile) => {
      if (!profile.online) return;
      haptic.select();
      const harnessId = profile.harness;
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
    ({ item }: ListRenderItemInfo<BotsListItem>) => {
      if (item.kind === "section") {
        return <SectionHeader title={item.title} online={item.online} />;
      }
      return <ProfileRow profile={item.profile} onPress={openProfile} />;
    },
    [openProfile],
  );

  const getItemType = useCallback((item: BotsListItem) => item.kind, []);

  return (
    <FlashList
      data={items}
      renderItem={renderItem}
      getItemType={getItemType}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No bots yet</Text>
          <Text style={styles.emptySub}>Connect to your bridge to load Hermes profiles and harness agents.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: 120 },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  sectionTitle: { color: colors.textMuted, ...type.small, textTransform: "uppercase", letterSpacing: 0.8 },
  profileCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  main: { flex: 1, minWidth: 0 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { color: colors.text, ...type.heading, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusOn: { backgroundColor: colors.ok },
  statusOff: { backgroundColor: colors.textFaint },
  role: { color: colors.textMuted, ...type.small, marginTop: 4, textTransform: "none", letterSpacing: 0 },
  desc: { color: colors.textFaint, fontSize: 13, marginTop: 6, lineHeight: 18 },
  empty: { paddingTop: "40%", paddingHorizontal: space.xl, alignItems: "center" },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
