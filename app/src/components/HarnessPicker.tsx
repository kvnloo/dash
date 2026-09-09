import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HarnessInfo } from "../../../shared/protocol";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

interface Props {
  visible: boolean;
  harnesses: HarnessInfo[];
  selected: string;
  onSelect(id: string): void;
  onClose(): void;
}

export function HarnessPicker({ visible, harnesses, selected, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable onPress={() => {}}>
          <GlassSurface variant="raised" borderRadius={radius.lg + 6} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
            <Text style={styles.label}>Harness</Text>
            {harnesses.map((h) => {
              const active = h.id === selected;
              return (
                <Pressable
                  key={h.id}
                  disabled={!h.available}
                  onPress={() => {
                    onSelect(h.id);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: !h.available }}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.name, !h.available && styles.unavailable]}>{h.name}</Text>
                    {!h.available ? <Text style={styles.hint}>Not installed on the bridge machine</Text> : null}
                  </View>
                  {active ? <Ionicons name="checkmark" size={20} color={colors.text} /> : null}
                </Pressable>
              );
            })}
            {harnesses.length === 0 ? <Text style={styles.hint}>Connect to the bridge to see harnesses.</Text> : null}
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: 2,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
  },
  label: { color: colors.textMuted, ...type.label, marginBottom: space.sm, marginLeft: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowText: { flex: 1 },
  name: { color: colors.text, ...type.heading },
  unavailable: { color: colors.textFaint },
  hint: { color: colors.textMuted, ...type.small, marginTop: 2 },
  pressed: { backgroundColor: colors.surfaceRaised },
});
