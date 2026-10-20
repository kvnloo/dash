import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { BotInfo, HostInfo } from "../../../../shared/protocol";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { botSummary, botTarget, botsRows, COLLAPSED_KEY, hostCountLabel, parseCollapsed, toggleCollapsed, type BotsRow } from "../../lib/bots";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ScreenProps } from "../../navigation";
import { openAgentConversation, store } from "../../store/app";
import { colors, fonts, glass, space, type } from "../../theme";

/** Host section header: a plain host glyph, never an identity orb. Tap to collapse. */
const HostHeader = memo(function HostHeader({ host, count, collapsed, onToggle }: { host: HostInfo; count: number | null; collapsed: boolean; onToggle(id: string): void }) {
  const counted = hostCountLabel(count);
  return (
    <PressScale
      onPress={() => onToggle(host.id)}
      accessibilityRole="button"
      accessibilityLabel={`${host.name}${counted ? `, ${counted}` : ""}, ${host.online ? "online" : "offline"}`}
      accessibilityState={{ expanded: !collapsed }}
      aria-expanded={!collapsed}
      style={styles.host}
    >
      <View style={styles.glyph}><Feather name={host.self ? "monitor" : "server"} size={15} color={colors.textMuted} /></View>
      <Text style={styles.hostName} numberOfLines={1}>{host.name}</Text>
      {host.address ? <Text style={styles.hostAddress} numberOfLines={1}>{host.address}</Text> : <View style={styles.flex} />}
      <Text style={styles.count}>{counted}</Text>
      <View style={[styles.dot, host.online ? styles.dotOn : styles.dotOff]} />
      <Feather name={collapsed ? "chevron-right" : "chevron-down"} size={16} color={colors.textTertiary} />
    </PressScale>
  );
});

const BotRow = memo(function BotRow({ host, bot, onPress, onLongPress }: { host: HostInfo; bot: BotInfo; onPress(host: HostInfo, bot: BotInfo): void; onLongPress?(bot: BotInfo): void }) {
  const running = bot.status === "running";
  return (
    <PressScale
      onPress={() => onPress(host, bot)}
      onLongPress={onLongPress ? () => onLongPress(bot) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${bot.name}, ${botSummary(bot)}`}
      style={styles.bot}
    >
      <View style={styles.main}>
        <Text style={[styles.botName, !running && styles.botIdle]} numberOfLines={1}>{bot.name}</Text>
        <Text style={styles.botMeta} numberOfLines={1}>{botSummary(bot)}</Text>
      </View>
      <View accessibilityLabel={running ? "Running" : "Not running"} style={[styles.dot, running ? styles.dotOn : styles.dotIdle]} />
    </PressScale>
  );
});

export function BotsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const hosts = store.use((s) => s.connection.hosts);
  const settings = store.use((s) => s.settings);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(COLLAPSED_KEY).then(raw => { if (live) setCollapsed(parseCollapsed(raw)); }, () => {});
    return () => { live = false; };
  }, []);

  const onToggle = useCallback((id: string) => {
    haptic.select();
    setCollapsed(current => {
      const next = toggleCollapsed(current, id);
      void AsyncStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const rows = useMemo(() => botsRows(hosts, collapsed), [hosts, collapsed]);

  const openBot = useCallback(
    (host: HostInfo, bot: BotInfo) => {
      haptic.select();
      const target = botTarget(host, bot);
      if (!target) {
        Alert.alert(bot.name, `${botSummary(bot)}.\n\nDash cannot open a chat with this bot from here. Message it on its own platform.`);
        return;
      }
      const result = openAgentConversation(target);
      if ("error" in result) {
        Alert.alert("Bot unavailable", result.error);
        return;
      }
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const onFeedback = useCallback(
    (bot: BotInfo) => {
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      haptic.select();
      submitInAppFeedback({ kind: "select", text: `Selected bot ${bot.name}`, selection: { kind: "bot", id: bot.id, label: bot.name } });
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const feedbackOn = inAppFeedbackEnabled(settings);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BotsRow>) => {
      if (item.kind === "host") return <HostHeader host={item.host} count={item.count} collapsed={item.collapsed} onToggle={onToggle} />;
      if (item.kind === "note") return <Text style={styles.note}>{item.text}</Text>;
      return <BotRow host={item.host} bot={item.bot} onPress={openBot} onLongPress={feedbackOn ? onFeedback : undefined} />;
    },
    [feedbackOn, onFeedback, onToggle, openBot],
  );

  const getItemType = useCallback((item: BotsRow) => item.kind, []);

  return (
    <FlashList
      data={rows}
      renderItem={renderItem}
      getItemType={getItemType}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No hosts yet</Text>
          <Text style={styles.emptySub}>Pair with a computer on Tailscale to see the bots deployed on it.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: 120 },
  flex: { flex: 1 },
  host: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48, marginTop: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  glyph: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: glass.fill, borderWidth: 1, borderColor: glass.hair },
  hostName: { ...type.heading, color: colors.text, flexShrink: 1 },
  hostAddress: { ...type.mono, color: colors.textTertiary, flex: 1, minWidth: 0 },
  count: { ...type.mono, color: colors.textTertiary },
  bot: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48, paddingVertical: 5, paddingLeft: 36, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.quiet },
  main: { flex: 1, minWidth: 0 },
  botName: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.text },
  botIdle: { color: colors.textMuted },
  botMeta: { ...type.small, color: colors.textTertiary },
  note: { ...type.small, color: colors.textTertiary, paddingLeft: 36, paddingVertical: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: colors.gold },
  dotIdle: { borderWidth: 1.5, borderColor: colors.textTertiary },
  dotOff: { backgroundColor: colors.textFaint },
  empty: { paddingTop: "40%", paddingHorizontal: space.xl, alignItems: "center" },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
