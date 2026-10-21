import { StyleSheet, Text, View } from "react-native";
import { PressScale } from "./PressScale";
import { haptic } from "../haptics";
import type { NavigationProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";
import { actionable, approvals } from "../store/approvals";
import { createConversation, store } from "../store/app";
import { colors, fonts, type } from "../theme";
import { TAB_LABELS, clampTab } from "./golden-nav";
import { IconButton } from "./ScreenHeader";

/**
 * The row under the top navigation bar on Main: the current pane's name (the dot pager has
 * no labels), pending approvals, compose and settings. Navigation itself stays in AppNav.
 */
export function WorkspaceHeader({ navigation, tab, titleOnly = false }: { navigation: NavigationProp<RootStackParamList>; tab: number; titleOnly?: boolean }) {
  const title = TAB_LABELS[clampTab(tab)];
  return <View style={styles.header}>
    <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
    {titleOnly ? null : <WorkspaceActions navigation={navigation} />}
  </View>;
}

export function WorkspaceActions({ navigation }: { navigation: NavigationProp<RootStackParamList> }) {
  const pending = approvals.use(s => s.items.filter(actionable).length);
  return <View style={styles.actions}>
    {pending > 0 ? <PressScale accessibilityRole="button" accessibilityLabel={`Approvals, ${pending} pending`} onPress={() => { haptic.select(); navigation.navigate("Approvals"); }} style={styles.approvals}>
      <Text style={styles.approvalsLabel}>Approvals</Text>
      {/* A sans numeral on a gold pill: a serif "1" beside a label reads as the letter I. */}
      <View style={styles.badge}><Text style={styles.badgeText}>{pending > 99 ? "99+" : pending}</Text></View>
    </PressScale> : null}
    <IconButton icon="edit-3" label="New chat" onPress={() => { createConversation(store.get().settings?.harness ?? "omp"); navigation.navigate("Chat"); }} />
    <IconButton icon="settings" label="Settings" onPress={() => navigation.navigate("Settings")} />
  </View>;
}

export const WORKSPACE_HEADER_HEIGHT = 52;

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", height: WORKSPACE_HEADER_HEIGHT, paddingLeft: 16, paddingRight: 8, gap: 2 },
  title: { ...type.title, color: colors.text, flex: 1 },
  approvals: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 8 },
  approvalsLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textMuted },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, color: colors.bg, fontVariant: ["tabular-nums"] },
});
