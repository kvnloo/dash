import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PressScale } from "../PressScale";
import { haptic } from "../../haptics";
import { traceStore } from "../../trace/source";
import { entryLine } from "../../trace/feed-state";
import { fonts, radius, space, type } from "../../theme";
import { LivePulse, tc } from "./tokens";

/** Orchestra's way into the trace. Shows live counts only after a real bridge snapshot. */
export const TraceEntryCard = memo(function TraceEntryCard({ onOpen }: { onOpen(): void }) {
  const feed = traceStore.use((s) => s.feed);
  const line = entryLine(feed);
  return (
    <PressScale onPress={() => { haptic.select(); onOpen(); }} style={styles.card} accessibilityRole="button" accessibilityLabel={`Agent trace: ${line}`} testID="trace-entry">
      <View style={styles.inner}>
        <View style={styles.top}>
          <Text style={styles.title}>Agent trace</Text>
          <Text style={styles.chev}>›</Text>
        </View>
        <View style={styles.row}>
          {feed.phase === "live" ? <LivePulse size={6} /> : null}
          <Text style={[styles.k, feed.phase === "live" ? { color: tc.live } : null]} numberOfLines={2}>{line}</Text>
        </View>
      </View>
    </PressScale>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, alignItems: "stretch", marginBottom: space.md },
  inner: { alignSelf: "stretch", backgroundColor: tc.raised, borderRadius: radius.md, borderWidth: 1, borderColor: tc.rule, padding: space.md, gap: 6 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { ...type.heading, color: tc.text },
  chev: { color: tc.text3, fontSize: 22, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  k: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3, flexShrink: 1 },
});
