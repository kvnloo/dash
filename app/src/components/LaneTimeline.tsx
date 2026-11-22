// z0live lane timeline (DA-077): one row per lane attached to the call's thread, with what it is
// doing now, how long it has been at it and what it last handed back. Collapsed to one summary
// line by default so it never crowds the hero orb; tap the line for the rows, tap a handoff for
// the full result.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Z0Lane } from "../../../shared/z0live-lanes";
import { laneElapsed, laneNow, laneSummary } from "../lib/lane-timeline";
import { colors, radius, space } from "../theme";

/** Seconds on the bridge's clock, ticking once a second while something on screen shows a clock. */
function useBridgeNow(offset: number, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000 + offset);
  useEffect(() => {
    setNow(Date.now() / 1000 + offset);
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now() / 1000 + offset), 1000);
    return () => clearInterval(timer);
  }, [offset, ticking]);
  return now;
}

function LaneRow({ lane, now }: { lane: Z0Lane; now: number }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const handoff = lane.handoff;
  return <View testID={`lane-row-${lane.id}`} style={styles.row}>
    <View style={styles.head}>
      <View style={[styles.dot, lane.status === "working" ? styles.working : lane.status === "error" ? styles.failed : styles.idle]} />
      <Text testID={`lane-name-${lane.id}`} numberOfLines={1} style={styles.name}>
        {lane.name}{lane.model ? <Text style={styles.model}> · {lane.model}</Text> : null}
      </Text>
      <Text testID={`lane-elapsed-${lane.id}`} style={styles.elapsed}>{laneElapsed(lane, now)}</Text>
    </View>
    <Text testID={`lane-step-${lane.id}`} numberOfLines={1} accessibilityLiveRegion="polite"
      style={[styles.step, lane.status === "error" && styles.stepFailed]}>{laneNow(lane)}</Text>
    {handoff ? <Pressable testID={`lane-handoff-${lane.id}`} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`${lane.name} handed back: ${handoff.summary}. ${open ? "Hide full result" : "Show full result"}`}
      onPress={() => setOpen(value => !value)} style={styles.handoff}>
      {open
        ? <ScrollView style={styles.result} nestedScrollEnabled><Text testID={`lane-result-${lane.id}`} selectable style={styles.resultText}>{handoff.result}</Text></ScrollView>
        : <Text testID={`lane-handoff-line-${lane.id}`} numberOfLines={1} style={styles.handoffText}><Text style={styles.arrow}>↳ </Text>{handoff.summary}</Text>}
    </Pressable> : null}
  </View>;
}

export function LaneTimeline({ lanes, offset }: { lanes: readonly Z0Lane[]; offset: number }): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const now = useBridgeNow(offset, expanded && lanes.length > 0);
  if (!lanes.length) return null;
  const summary = laneSummary(lanes);
  return <View testID="lane-timeline" style={styles.panel}>
    <Pressable testID="lane-timeline-summary" accessibilityRole="button" accessibilityState={{ expanded }}
      accessibilityLabel={`Lanes: ${summary}. ${expanded ? "Hide lanes" : "Show lanes"}`}
      onPress={() => setExpanded(value => !value)} style={styles.summary}>
      <View style={[styles.dot, lanes.some(lane => lane.status === "working") ? styles.working : styles.idle]} />
      <Text testID="lane-timeline-summary-text" numberOfLines={1} style={styles.summaryText}>{summary}</Text>
      <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>
    </Pressable>
    {expanded ? <ScrollView testID="lane-timeline-rows" style={styles.rows} nestedScrollEnabled>
      {lanes.map(lane => <LaneRow key={lane.id} lane={lane} now={now} />)}
    </ScrollView> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { alignSelf: "stretch", borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hair, backgroundColor: colors.surface, overflow: "hidden" },
  summary: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md },
  summaryText: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  chevron: { color: colors.textFaint, fontSize: 12 },
  rows: { maxHeight: 280, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hair },
  row: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  working: { backgroundColor: colors.accent },
  idle: { backgroundColor: colors.textFaint },
  failed: { backgroundColor: colors.danger },
  name: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  model: { color: colors.textTertiary, fontWeight: "400" },
  elapsed: { color: colors.textTertiary, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
  step: { color: colors.textMuted, fontSize: 13, lineHeight: 18, paddingLeft: 14 },
  stepFailed: { color: colors.danger },
  handoff: { minHeight: 28, justifyContent: "center", paddingLeft: 14 },
  handoffText: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
  arrow: { color: colors.textFaint },
  result: { maxHeight: 160, marginTop: 2 },
  resultText: { color: colors.text, fontSize: 12, lineHeight: 17 },
});
