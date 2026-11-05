import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import {
  SERVED_BUILD,
  TURBO,
  servedAgeLabel,
  servedBuildKey,
  servedBuildLabel,
  shouldShowServedChip,
} from "../turbo";

/** Mount inside SafeAreaProvider near the app root; never renders in non-turbo builds. */
export function ServedBuildChip() {
  const insets = useSafeAreaInsets();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const key = servedBuildKey(SERVED_BUILD);
  const visible = shouldShowServedChip(TURBO, hiddenFor, SERVED_BUILD);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;
  const label = servedBuildLabel(SERVED_BUILD, now);

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + space.xs }]}>
      <Pressable
        testID="turbo-served-build"
        accessibilityRole="button"
        accessibilityLabel={
          "Served bundle " + (SERVED_BUILD.sha ?? "unknown SHA") + ", " +
          servedAgeLabel(SERVED_BUILD.servedAtMs, now) + ". Tap to hide."
        }
        accessibilityHint="Hides the chip until a different bundle is served"
        onPress={() => setHiddenFor(key)}
        style={styles.touchTarget}
      >
        <View pointerEvents="none" style={styles.chip}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", right: space.sm, zIndex: 1000 },
  touchTarget: { minWidth: controlMin, minHeight: controlMin, alignItems: "center", justifyContent: "center" },
  chip: {
    backgroundColor: colors.bg,
    borderColor: glass.hair2,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  label: { ...type.mono, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
