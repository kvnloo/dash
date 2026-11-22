import { Feather } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { newAgentSections, type NewAgentRow } from "../lib/new-agent";
import { createConversation, saveSettings, store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";

interface Props {
  visible: boolean;
  onClose(): void;
  /** Called after the new chat is created and active. */
  onStarted(): void;
}

/**
 * New agent: every harness the paired computer reports (local CLIs and Cursor cloud) and every
 * bot it can start a chat with (Hermes gateway profiles, GrokBot). Tapping a row creates that
 * chat; the first message launches the agent on the host.
 */
export function NewAgentSheet({ visible, onClose, onStarted }: Props) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const connection = store.use(s => s.connection);
  const settings = store.use(s => s.settings);
  const sections = newAgentSections(connection);

  const start = (row: NewAgentRow) => {
    if (row.disabled || !settings) return;
    haptic.tap();
    if (row.kind === "harness") saveSettings({ ...settings, harness: row.harness });
    createConversation(row.harness, row.profileId ? { profileId: row.profileId, profileName: row.profileName } : undefined);
    onClose();
    onStarted();
  };

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} focusable={false} importantForAccessibility="no-hide-descendants" />
        <GlassSurface
          variant="raised"
          borderRadius={radius.md}
          style={styles.sheet}
          contentStyle={{ paddingBottom: Math.max(insets.bottom, space.lg) }}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          testID="new-agent-sheet"
        >
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">New agent</Text>
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close new agent">
              <Feather name="x" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {sections.length === 0 ? <Text style={styles.hint}>Connect to the bridge to see harnesses and bots.</Text> : null}
            {sections.map(section => (
              <View key={section.id} style={styles.section} testID={`new-agent-section-${section.id}`}>
                <Text style={styles.label} accessibilityRole="header">{section.title}</Text>
                {section.rows.map(row => (
                  <PressScale
                    key={row.id}
                    testID={`new-agent-row-${row.id}`}
                    disabled={row.disabled || !settings}
                    onPress={() => start(row)}
                    style={styles.row}
                    accessibilityRole="button"
                    accessibilityLabel={row.label}
                    accessibilityHint={row.hint}
                    accessibilityState={{ disabled: row.disabled }}
                  >
                    <View style={[styles.dot, { backgroundColor: row.disabled ? colors.textFaint : row.live ? colors.ok : colors.textMuted }]} />
                    <View style={styles.rowText}>
                      <Text style={[styles.name, row.disabled && styles.off]} numberOfLines={1}>{row.name}</Text>
                      {row.detail ? <Text style={styles.hint} numberOfLines={2}>{row.detail}</Text> : null}
                    </View>
                    {row.disabled ? null : <Feather name="plus" size={18} color={colors.textMuted} />}
                  </PressScale>
                ))}
              </View>
            ))}
          </ScrollView>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    maxHeight: "86%",
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  title: { color: colors.gold, ...type.cardTitle, marginLeft: space.sm },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: space.md, paddingBottom: space.sm },
  section: { gap: 2 },
  label: { color: colors.textMuted, ...type.small, marginLeft: space.sm, marginBottom: 2 },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center", minHeight: 44, paddingVertical: 10, paddingHorizontal: space.sm, borderRadius: radius.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1 },
  name: { color: colors.text, ...type.heading },
  off: { color: colors.textFaint },
  hint: { color: colors.textMuted, ...type.small, marginTop: 2 },
});
