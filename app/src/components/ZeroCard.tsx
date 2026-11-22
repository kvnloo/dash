import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { hostDisplayName } from "../../../shared/host-display";
import type { HostInfo } from "../../../shared/protocol";
import { haptic } from "../haptics";
import { store } from "../store/app";
import { colors, glass, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";
import { TraceEntryCard } from "./trace/TraceEntryCard";
import { LivePulse, tc } from "./trace/tokens";

const TUCK_KEY = "dash.zeroCard.tucked.v1";

/** The paired computer (Zero) in one line: name, reachability and how much of it is live. */
export function zeroSummary(hosts: readonly HostInfo[]): { name: string; line: string; live: number } {
  const host = hosts.find(h => h.self) ?? hosts[0];
  if (!host) return { name: "Not paired", line: "No computer reported", live: 0 };
  const live = host.agents.filter(a => a.status === "running").length;
  const sessions = host.agents.filter(a => a.sessionId).length;
  return { name: hostDisplayName(host), line: `${host.online ? "online" : "offline"} · ${live} live · ${sessions} sessions`, live };
}

/**
 * One card anchored to the main input: Zero (the paired computer) with the agent trace nested in it.
 * Tucks down to a single line and comes back; the choice survives a restart.
 */
export const ZeroCard = memo(function ZeroCard({ onOpenTrace }: { onOpenTrace(): void }) {
  const hosts = store.use(s => s.connection.hosts);
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(TUCK_KEY).then(value => { if (live && value === "1") setTucked(true); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const toggle = () => {
    haptic.select();
    setTucked(value => {
      void AsyncStorage.setItem(TUCK_KEY, value ? "0" : "1").catch(() => undefined);
      return !value;
    });
  };
  const zero = zeroSummary(hosts);
  return <View testID="zero-card" accessibilityLabel={`Zero card, ${tucked ? "tucked" : "shown"}`} style={styles.card}>
    <View style={styles.top}>
      <LivePulse size={6} color={zero.live > 0 ? tc.live : tc.text3} />
      <Text style={styles.title}>Zero</Text>
      <Text testID="zero-card-host" style={styles.host} numberOfLines={1}>{zero.name} · {zero.line}</Text>
      <PressScale testID="zero-card-tuck" accessibilityRole="button" accessibilityLabel={tucked ? "Show Zero card" : "Tuck Zero card"} accessibilityState={{ expanded: !tucked }} onPress={toggle} hitSlop={6} style={styles.tuck}>
        <Feather name={tucked ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
      </PressScale>
    </View>
    {tucked ? null : <TraceEntryCard onOpen={onOpenTrace} />}
  </View>;
});

const styles = StyleSheet.create({
  card: { marginHorizontal: space.md, marginBottom: space.xs, padding: space.sm, gap: space.xs, borderRadius: radius.lg, backgroundColor: glass.fillRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.xs },
  title: { ...type.label, color: colors.text },
  host: { ...type.mono, fontSize: 11, color: colors.textTertiary, flex: 1, minWidth: 0 },
  tuck: { width: 44, height: 36, alignItems: "center", justifyContent: "center" },
});
