// A13: "an ephemeral-ui component for blockers and todos … should be able to pin to the input text
// bar". A one-line pin above the main input that counts what is waiting on the owner (Needs OK,
// bulk-safe upstream approvals, blocked work) and opens Quick mode, the full dashboard. Hidden when
// nothing waits, so the bar stays calm.
import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text } from "react-native";
import { parseTriage } from "../../../shared/triage";
import { executionToken } from "../lib/bridge-auth";
import { bulkPermissionChoices, bulkSafeGateItems } from "../lib/bulk-approve";
import { quickItems } from "../lib/ephemeral-modes";
import { haptic } from "../haptics";
import { bridge, permissionRequests } from "../net/bridge";
import { approvals } from "../store/approvals";
import { store } from "../store/app";
import { setPillMode, surfaceMode } from "../store/ephemeral-mode";
import { colors, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";

export function pinLabel(needOk: number, upstream: number, blocked: number): string | null {
  const parts = [needOk ? `${needOk} need OK` : "", upstream ? `${upstream} upstream` : "", blocked ? `${blocked} blocked` : ""].filter(Boolean);
  return parts.length ? `⚡ ${parts.join(" · ")}` : null;
}

function useBlockedCount(): number {
  const settings = store.use(s => s.settings);
  const [blocked, setBlocked] = useState(0);
  useEffect(() => {
    if (!settings) return;
    let disposed = false;
    const load = async () => {
      if (AppState.currentState !== "active") return;
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${settings.address}/triage`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
        const snapshot = response.ok ? parseTriage(await response.json()) : null;
        if (!disposed && snapshot) setBlocked(quickItems(snapshot, new Set()).length);
      } catch { /* the pin is a hint; Quick shows the real error */ }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [settings]);
  return blocked;
}

export function QuickPin(): React.JSX.Element | null {
  const online = store.use(s => s.connection.status === "online");
  const records = permissionRequests.state.use(s => s.records);
  const gate = approvals.use(s => s.items);
  const open = surfaceMode.use(s => s === "quick");
  const blocked = useBlockedCount();
  useEffect(() => { if (online) bridge.send({ type: "gate_list" }); }, [online]);
  const label = pinLabel(bulkPermissionChoices(Object.values(records), Date.now()).length, bulkSafeGateItems(gate).length, blocked);
  if (!label || open) return null;
  return (
    <PressScale testID="quick-pin" accessibilityRole="button" accessibilityLabel={`${label.slice(2)}. Open Quick mode`}
      onPress={() => { haptic.select(); setPillMode("quick"); }} style={styles.pin}>
      <Text style={styles.text} numberOfLines={1}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  pin: { alignSelf: "flex-start", minHeight: 36, marginHorizontal: space.sm, marginBottom: space.xs, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.surfaceRaised },
  text: { ...type.mono, color: colors.gold },
});
