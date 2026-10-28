import { StyleSheet, Text, View } from "react-native";
import { composerChips, type ComposerChipsInput, type ChipModel } from "../lib/composer-chips";
import { colors, glass, radius, type } from "../theme";

/**
 * Passive composer metadata. The rate slot is always reserved while a turn is
 * streaming (or recent), so receiving the first sample never moves the input.
 * The host owns the rate sample and the five-second recent window.
 */
export function ComposerStatChips(props: ComposerChipsInput) {
  const chips = composerChips(props);
  const model = chips.find(chip => chip.id === "model");
  const rate = chips.find(chip => chip.id === "rate");

  if (!model && !rate && !props.streaming && !props.recent) return null;

  return (
    <View testID="composer-stat-chips" style={styles.row} pointerEvents="none">
      {model ? <StatChip chip={model} /> : null}
      <View testID="composer-stat-rate-slot" style={styles.rateSlot}>
        {rate ? <StatChip chip={rate} rate /> : null}
      </View>
    </View>
  );
}

function StatChip({ chip, rate = false }: { chip: ChipModel; rate?: boolean }) {
  return (
    <View testID={"composer-stat-" + chip.id} style={[styles.chip, rate ? styles.rateChip : styles.modelChip]}>
      <Text
        accessible
        accessibilityRole="text"
        accessibilityLabel={chip.accessibilityLabel}
        numberOfLines={1}
        ellipsizeMode="middle"
        style={rate ? styles.rateText : styles.modelText}
      >
        {chip.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, flexShrink: 1 },
  chip: {
    minHeight: 28, justifyContent: "center", alignItems: "center",
    paddingHorizontal: 8, borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair, borderTopColor: glass.hair2,
    backgroundColor: glass.fillChip,
  },
  modelChip: { maxWidth: 162, flexShrink: 1 },
  modelText: { fontSize: 12, lineHeight: 16, color: colors.textMuted },
  // The fixed slot reserves the largest expected formatted value ("≈9999 tok/s").
  rateSlot: { minWidth: 112, width: 112, height: 28, flexShrink: 0 },
  rateChip: { width: "100%" },
  rateText: { ...type.mono, fontSize: 12, lineHeight: 16, color: colors.textMuted },
});
