import { Feather } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";
import { useHandedness } from "../lib/useHandedness";
import { activateHarnessPickerRow, harnessPickerRowA11y } from "../lib/a11y-harness-picker";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HarnessInfo } from "../../../shared/protocol";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";

interface Props {
  visible: boolean;
  harnesses: HarnessInfo[];
  selected: string;
  onSelect(id: string): void;
  onClose(): void;
}

export function HarnessPicker({ visible, harnesses, selected, onSelect, onClose }: Props) {
  const thumb = useHandedness();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        {/* Touch outside dismisses; keep the backdrop out of screen-reader focus. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          focusable={false}
          importantForAccessibility="no-hide-descendants"
        />
        <GlassSurface
          variant="raised"
          borderRadius={radius.md}
          style={styles.sheet}
          contentStyle={{ paddingBottom: Math.max(insets.bottom, space.lg) }}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <View style={styles.header}>
            <Text style={styles.label} accessibilityRole="header">Harness</Text>
            <Pressable
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close harness picker"
              accessibilityHint="Return to chat"
            >
              <Feather name="x" size={20} color={colors.text} />
            </Pressable>
          </View>
          {harnesses.map((h, index) => {
            const row = harnessPickerRowA11y(h, selected);
            return (
              <PressScale
                key={row.id ?? `unknown-${index}`}
                disabled={row.disabled}
                onPress={() => activateHarnessPickerRow(row, onSelect, onClose)}
                style={[styles.row, thumb.row]}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                accessibilityHint={row.hint}
                accessibilityState={row.state}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.name, row.disabled && styles.unavailable]}>{row.name}</Text>
                  {row.disabled ? <Text style={styles.hint}>{row.hint}</Text> : null}
                </View>
                {row.state.selected ? <Feather name="check" size={20} color={colors.text} /> : null}
              </PressScale>
            );
          })}
          {harnesses.length === 0 ? <Text style={styles.hint}>Connect to the bridge to see harnesses.</Text> : null}
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  // Opaque raised base under the glass tint: chat text must not read through the list.
  sheet: {
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: 2,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  label: { color: colors.gold, ...type.cardTitle, marginLeft: space.sm },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  row: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    minHeight: 44,
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowText: { flex: 1 },
  name: { color: colors.text, ...type.heading },
  unavailable: { color: colors.textFaint },
  hint: { color: colors.textMuted, ...type.small, marginTop: 2 },
});
