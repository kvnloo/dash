import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { HarnessAvatar } from "../../components/HarnessAvatar";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { loadAodlOrchestras, type OrchestraProject } from "../../catalog/orchestra";
import { enrichProducts } from "../../lib/global-search";
import type { ScreenProps } from "../../navigation";
import { store } from "../../store/app";
import { colors, radius, space, type } from "../../theme";
import { timeAgo } from "../../util";

const STATUS_COLOR = {
  active: colors.ok,
  idle: colors.textMuted,
  paused: colors.warn,
} as const;

const Card = memo(function Card({
  item,
  harnessNames,
  onPress,
}: {
  item: OrchestraProject;
  harnessNames: string[];
  onPress(id: string): void;
}) {
  return (
    <PressScale onPress={() => onPress(item.id)} style={styles.card} accessibilityRole="button">
      <View style={styles.cardTop}>
        <View style={styles.cardTitles}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {item.subtitle}
          </Text>
        </View>
        <View
          style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] }]}
          accessibilityLabel={item.status}
        />
      </View>
      <View style={styles.agents}>
        {harnessNames.slice(0, 4).map((name) => (
          <HarnessAvatar key={name} name={name} size={36} />
        ))}
        {harnessNames.length > 4 ? (
          <View style={styles.more}>
            <Text style={styles.moreText}>+{harnessNames.length - 4}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={styles.meta}>
          {item.agents.length} agent{item.agents.length === 1 ? "" : "s"} · {item.chatIds.length} chat
          {item.chatIds.length === 1 ? "" : "s"}
        </Text>
        <Text style={styles.time}>{timeAgo(item.updatedAt)}</Text>
      </View>
    </PressScale>
  );
});

export function OrchestraPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const harnesses = store.use((s) => s.connection.harnesses);
  const conversations = store.use((s) => s.conversations);
  const projects = useMemo(() => {
    return enrichProducts(conversations, loadAodlOrchestras());
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
      const harnessNames = item.agents.map((id) => harnesses.find((h) => h.id === id)?.name ?? id);
      return <Card item={item} harnessNames={harnessNames} onPress={open} />;
    },
    [harnesses, open],
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
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  agents: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  more: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: space.md },
  meta: { color: colors.textFaint, fontSize: 12 },
  time: { color: colors.textFaint, fontSize: 12 },
  empty: { paddingTop: "35%", paddingHorizontal: space.xl, alignItems: "center" },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
