import { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../theme";
import {
  getInformationDetailChoice,
  INFORMATION_DETAIL_CHOICES,
  resolveInformationDetail,
  setInformationDetailChoice,
  subscribeInformationDetail,
  type InformationDetailChoice,
} from "../lib/information-density";
import { useDensity } from "./Density";
import { PressScale } from "./PressScale";

const names: Record<InformationDetailChoice, string> = {
  auto: "Auto",
  essential: "Essential",
  standard: "Standard",
  rich: "Rich",
};

/** Independent evidence selection, shared between Trace and Lab screen mounts. */
export function useInformationDetail() {
  const { density } = useDensity();
  const choice = useSyncExternalStore(subscribeInformationDetail, getInformationDetailChoice, getInformationDetailChoice);
  return { choice, level: resolveInformationDetail(density, choice) };
}

export function InformationDensityPicker() {
  const { choice, level } = useInformationDetail();
  return (
    <View style={styles.row} testID="information-detail-picker">
      <Text allowFontScaling accessibilityRole="header" style={styles.caption}>DETAIL</Text>
      {INFORMATION_DETAIL_CHOICES.map(option => (
        <PressScale
          key={option}
          onPress={() => setInformationDetailChoice(option)}
          accessibilityRole="button"
          accessibilityLabel={"Information detail " + names[option]}
          accessibilityHint={option === "auto"
            ? "Follow layout preset, currently " + level + " information"
            : "Show " + option + " information independently of layout"}
          accessibilityState={{ selected: choice === option }}
          testID={"information-detail-" + option}
          style={[styles.choice, choice === option && styles.selected]}
        >
          <Text allowFontScaling style={styles.choiceText}>{names[option]}</Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  caption: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginRight: 4 },
  choice: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  selected: { borderColor: colors.text, backgroundColor: colors.surfaceRaised },
  choiceText: { fontFamily: fonts.mono, fontSize: 11, color: colors.text, textAlign: "center" },
});
