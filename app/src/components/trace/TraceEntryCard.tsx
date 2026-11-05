import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PressScale } from "../PressScale";
import { haptic } from "../../haptics";
import { traceStore } from "../../trace/source";
import { fonts, radius, space, type } from "../../theme";
import { LivePulse, tc } from "./tokens";

/** Orchestra's way into the trace: live / cut / asks at a glance, tap to open. */
export const TraceEntryCard = memo(function TraceEntryCard({ onOpen }: { onOpen(): void }) {
  const st = traceStore.use((s) => s.snapshot.stats);
  return (
    <PressScale onPress={() => { haptic.select(); onOpen(); }} style={styles.card} accessibilityRole="button" accessibilityLabel={`Agent trace: ${st.live} live, ${st.cut} cut, ${st.asks} need OK`} testID="trace-entry">
      <View style={styles.inner}>
        <View style={styles.top}>
          <Text style={styles.title}>Agent trace</Text>
          <Text style={styles.chev}>›</Text>
        </View>
        <View style={styles.row}>
          <LivePulse size={6} />
          <Text style={[styles.k, { color: tc.live }]}>{st.live} live</Text>
          <Text style={[styles.k, { color: tc.cut }]}>{st.cut} cut</Text>
          <Text style={[styles.k, { color: tc.ask }]}>{st.asks} need{st.asks === 1 ? "s" : ""} OK</Text>
          <Text style={styles.k}>{st.workers} workers · 12 h</Text>
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
  k: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3 },
});
