import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PressScale } from "../PressScale";
import { haptic } from "../../haptics";
import { traceStore } from "../../trace/source";
import { store } from "../../store/app";
import { entryLine, isFreshBridgeTrace } from "../../trace/feed-state";
import { fonts, radius, space, type } from "../../theme";
import { LivePulse, tc } from "./tokens";

/** Orchestra's way into the trace. Shows live counts only after a real bridge snapshot. */
export const TraceEntryCard = memo(function TraceEntryCard({ onOpen }: { onOpen(): void }) {
  const feed = traceStore.use((s) => s.feed);
  const paired = store.use((s) => Boolean(s.settings?.address && (s.settings.token || s.settings.identity)));
  const [, refreshClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refreshClock((tick) => tick + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  // Re-evaluate immediately on a newly arrived bridge snapshot, not the last timer tick.
  const now = Date.now();
  const fresh = isFreshBridgeTrace(feed, now);
  const line = entryLine(feed, paired, now);
  return (
    <PressScale onPress={() => { haptic.select(); onOpen(); }} style={styles.card} accessibilityRole="button" accessibilityLabel={`Agent trace: ${line}`} testID="trace-entry">
      <View style={styles.inner}>
        <View style={styles.top}>
          <Text style={styles.title}>Agent trace</Text>
          <Text style={styles.chev}>›</Text>
        </View>
        <View style={styles.row}>
          {fresh ? <LivePulse size={6} /> : null}
          <Text style={[styles.k, fresh ? { color: tc.live } : null]} numberOfLines={3}>{line}</Text>
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
