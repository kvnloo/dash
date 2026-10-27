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
import { WORKSPACE_ACTION_LABELS, upstreamApprovalAction, workspaceHeadingLabel } from "../lib/a11y-workspace-header";

/**
 * The row under the top navigation bar on Main: the current pane's name (the dot pager has
 * no labels), pending approvals, compose and settings. Navigation itself stays in AppNav.
 */
export function WorkspaceHeader({ navigation, tab, titleOnly = false }: { navigation: NavigationProp<RootStackParamList>; tab: number; titleOnly?: boolean }) {
  const title = TAB_LABELS[clampTab(tab)];
  return <View style={styles.header}>
    <Text style={styles.title} numberOfLines={1} accessibilityRole="header" accessibilityLabel={workspaceHeadingLabel(tab)}>{title}</Text>
    {titleOnly ? null : <WorkspaceActions navigation={navigation} />}
  </View>;
}

export function WorkspaceActions({ navigation }: { navigation: NavigationProp<RootStackParamList> }) {
  const pending = approvals.use(s => s.items.filter(actionable).length);
  const upstreamAction = upstreamApprovalAction(pending);
  return <View style={styles.actions}>
    {/* The pill is a column PressScale around a fixed row. A row-direction PressScale grows its
        flex: 1 inner view to the whole header width, which pushed the trace, new chat and settings
        buttons off screen (and out of the accessibility tree) whenever approvals were pending. */}
    {upstreamAction ? <PressScale accessibilityRole="button" accessibilityLabel={upstreamAction.label} accessibilityHint={upstreamAction.hint} onPress={() => { haptic.select(); navigation.navigate("Approvals"); }} style={styles.approvals}>
      <View style={styles.approvalsRow}>
        <Text style={styles.approvalsLabel}>Approvals</Text>
        {/* A sans numeral on a gold pill: a serif "1" beside a label reads as the letter I. */}
        <View style={styles.badge}><Text style={styles.badgeText}>{upstreamAction.badgeText}</Text></View>
      </View>
    </PressScale> : null}
    <IconButton icon="activity" label={WORKSPACE_ACTION_LABELS.trace} onPress={() => navigation.navigate("Trace")} />
    <IconButton icon="edit-3" label={WORKSPACE_ACTION_LABELS.newChat} onPress={() => { createConversation(store.get().settings?.harness ?? "omp"); navigation.navigate("Chat"); }} />
    <IconButton icon="settings" label={WORKSPACE_ACTION_LABELS.settings} onPress={() => navigation.navigate("Settings")} />
  </View>;
}

export const WORKSPACE_HEADER_HEIGHT = 52;

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  header: { flexDirection: "row", alignItems: "center", minHeight: WORKSPACE_HEADER_HEIGHT, paddingVertical: 4, paddingLeft: 16, paddingRight: 8, gap: 2 },
  title: { ...type.title, color: colors.text, flex: 1 },
  approvals: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  approvalsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  approvalsLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textMuted },
  badge: { minWidth: 18, minHeight: 18, borderRadius: 9, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, color: colors.bg, fontVariant: ["tabular-nums"] },
});
