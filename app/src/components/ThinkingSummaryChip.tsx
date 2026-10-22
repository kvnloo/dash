import { Text, View, StyleSheet } from "react-native";
import type { SummaryInfo } from "../../../shared/thinking-summary";
import { parseSummary } from "../../../shared/thinking-summary";
import { replySummaries, useKeyed } from "../store/text";
import { colors, type } from "../theme";
export function ThinkingSummaryChip({ turnId, summary }: { turnId: string; summary: SummaryInfo }) {
  const live = useKeyed(replySummaries, `${turnId}:${summary.kind === "turn" ? "turn" : summary.blockId}`);
  let current = summary;
  try { current = parseSummary(JSON.parse(live)) ?? summary; } catch { /* Persisted summary after relaunch. */ }
  return <View style={styles.chip} accessibilityLabel={current.kind === "turn" ? "Turn summary" : "Thinking summary"}>
    <Text numberOfLines={3} style={styles.label}>Thought {Math.round(current.durationMs / 1000)} s · {current.text}</Text>
  </View>;
}
const styles = StyleSheet.create({
  chip: { borderLeftWidth: 1, borderColor: colors.accent, paddingLeft: 10, paddingVertical: 6, marginBottom: 8 },
  label: { ...type.small, color: colors.textMuted },
});
