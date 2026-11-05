import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { colors, glass, space } from "../theme";

/** Fixed row heights keep FlashList v2 measurement stable while pages stream in. */
export const CHAT_ROW_HEIGHT = 72;
export const SECTION_ROW_HEIGHT = 32;

/** A still, fixed-height placeholder for a chat row that is loading. */
export const SkeletonRow = memo(function SkeletonRow({ height = CHAT_ROW_HEIGHT }: { height?: number }) {
  return (
    <View style={[styles.row, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.orb} />
      <View style={styles.lines}>
        <View style={[styles.line, styles.title]} />
        <View style={[styles.line, styles.meta]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg },
  orb: { width: 28, height: 28, borderRadius: 14, backgroundColor: glass.quiet },
  lines: { flex: 1, gap: space.sm },
  line: { height: 10, borderRadius: 5, backgroundColor: glass.quiet, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hair },
  title: { width: "58%" },
  meta: { width: "36%" },
});
