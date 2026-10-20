import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { runtimeStateFromAgent } from "../../catalog/runtime-state";
import { HarnessAvatar } from "../../components/HarnessAvatar";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import { canChatWithAgent, emptyHostProfile, profileFromAgent } from "../../lib/roster";
import type { BotProfile } from "../../mock/bots";
import type { ScreenProps } from "../../navigation";
import { openBotConversation, store } from "../../store/app";
import { colors, space, type } from "../../theme";

type BotsListItem =
  | { kind: "section"; id: string; title: string; subtitle?: string; online: boolean }
  | { kind: "profile"; id: string; profile: BotProfile; chat: boolean };

const ProfileRow = memo(function ProfileRow({
  profile,
  chat,
  onPress,
  onLongPress,
}: {
  profile: BotProfile;
  chat: boolean;
  onPress(profile: BotProfile): void;
  onLongPress?(profile: BotProfile): void;
}) {
  const canOpen = profile.online && chat;
  return (
    <PressScale
      onPress={() => onPress(profile)}
      onLongPress={onLongPress ? () => onLongPress(profile) : undefined}
      delayLongPress={350}
      style={[styles.profileCard, !profile.online && styles.offline]}
      accessibilityRole="button"
      accessibilityHint={canOpen ? "Open this agent" : "Show why this agent is unavailable"}
    >
      <HarnessAvatar
        name={profile.name}
        harnessId={profile.harness}
        size={44}
        stateId={runtimeStateFromAgent(profile.online ? "available" : "offline")}
      />
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
        <Text style={styles.desc} numberOfLines={1}>
          {profile.description}
        </Text>
      </View>
    </PressScale>
  );
});

const SectionHeader = memo(function SectionHeader({
  title,
  subtitle,
  online,
}: {
  title: string;
  subtitle?: string;
  online: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.statusDot, online ? styles.statusOn : styles.statusOff]} />
    </View>
  );
});

export function BotsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const harnesses = store.use((s) => s.connection.harnesses);
  const hosts = store.use((s) => s.connection.hosts);
  const settings = store.use((s) => s.settings);
  const chatKinds = useMemo(() => new Set(harnesses.filter((h) => h.available).map((h) => h.id)), [harnesses]);

  const items = useMemo((): BotsListItem[] => {
    const out: BotsListItem[] = [];
    if (hosts.length > 0) {
      for (const host of hosts) {
        const subtitle = [host.hostname !== host.name ? host.hostname : undefined, host.address].filter(Boolean).join(" · ");
        out.push({ kind: "section", id: `sec-${host.id}`, title: host.name, subtitle, online: host.online });
        if (host.agents.length === 0) {
          out.push({
            kind: "profile",
            id: `host:${host.id}`,
            chat: false,
            profile: emptyHostProfile(host),
          });
          continue;
        }
        for (const agent of host.agents) {
          const profile = profileFromAgent(host, agent);
          out.push({
            kind: "profile",
            id: profile.id,
            profile,
            chat: canChatWithAgent(agent, { self: host.self, availableKinds: chatKinds }),
          });
        }
      }
      return out;
    }
    return out;
  }, [chatKinds, harnesses, hosts]);

  const openProfile = useCallback(
    (profile: BotProfile) => {
      haptic.select();
      const result = openBotConversation(profile);
      if ("error" in result) {
        Alert.alert("Agent unavailable", result.error);
        return;
      }
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const onFeedback = useCallback(
    (profile: BotProfile) => {
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      haptic.select();
      submitInAppFeedback({
        kind: "select",
        text: `Selected bot ${profile.name}`,
        selection: { kind: "bot", id: profile.id, label: profile.name },
      });
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const feedbackOn = inAppFeedbackEnabled(settings);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BotsListItem>) => {
      if (item.kind === "section") {
        return <SectionHeader title={item.title} subtitle={item.subtitle} online={item.online} />;
      }
      return (
        <ProfileRow
          profile={item.profile}
          chat={item.chat}
          onPress={openProfile}
          onLongPress={feedbackOn ? onFeedback : undefined}
        />
      );
    },
    [feedbackOn, onFeedback, openProfile],
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
          <Text style={styles.emptyTitle}>No hosts yet</Text>
          <Text style={styles.emptySub}>Pair with a computer on Tailscale to see hosts and live agents.</Text>
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
    gap: space.md,
  },
  sectionText: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.textMuted, ...type.small, textTransform: "uppercase", letterSpacing: 0.8 },
  sectionSub: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  profileCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  offline: { opacity: 0.42 },
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
