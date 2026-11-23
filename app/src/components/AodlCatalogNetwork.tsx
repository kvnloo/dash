import { useMemo, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { HostInfo } from "../../../shared/protocol";
import type { OrchestraSnapshot } from "../../../shared/orchestra";
import { aodlLiveLabel, aodlLiveStates } from "../catalog/network-live";
import { loadAodlNetworkView } from "../catalog/network-view";
import { colors, glass, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";

const catalog = (() => {
  try {
    return loadAodlNetworkView();
  } catch {
    return null;
  }
})();

/** The pinned AODL product network, each node with its observed live state from the paired bridge. */
export function AodlCatalogNetwork({ hosts = [], snapshot = null }: { hosts?: HostInfo[]; snapshot?: OrchestraSnapshot | null }) {
  const [expanded, setExpanded] = useState(true);
  const live = useMemo(() => aodlLiveStates(hosts, snapshot), [hosts, snapshot]);
  const observed = hosts.some((host) => host.online) || snapshot !== null;
  const liveCount = [...live.values()].filter((node) => node.state === "live").length;
  return (
    <View style={styles.root} testID="aodl-catalog-network">
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="AODL network catalog"
        accessibilityHint="Show or hide the pinned product network"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((visible) => !visible)}
        style={styles.toggle}
      >
        <Text style={styles.title}>{observed ? `AODL network · ${liveCount} live` : "AODL network · catalog"}</Text>
        <Text style={styles.toggleLabel}>{expanded ? "Hide" : "Show"}</Text>
      </PressScale>
      {expanded && !catalog ? (
        <Text style={styles.warning} accessibilityRole="alert">
          Pinned AODL catalog is invalid. Network hidden.
        </Text>
      ) : null}
      {expanded && catalog ? (
        <View style={styles.contents}>
          <Text style={styles.caption}>{observed ? "Live from the paired bridge · roster and session graph" : "Pinned catalog · pair with a bridge to see live sessions"}</Text>
          {catalog.nodes.map((node) => {
            const state = live.get(node.id);
            const status = aodlLiveLabel(state);
            return (
            <PressScale
              key={node.id}
              testID={`aodl-node-${node.id}`}
              accessibilityRole="link"
              accessibilityLabel={
                node.id + ". " + status + ". Owns: " + node.owns + ". Linked harnesses: " +
                (node.linkedHarnessIds.join(", ") || "none declared")
              }
              accessibilityHint="Open repository on GitHub"
              onPress={() => { void Linking.openURL(node.repo); }}
              style={styles.node}
            >
              <View style={styles.nodeBody}>
                <View style={styles.nodeHead}>
                  <View style={[styles.dot, state?.state === "live" ? styles.dotLive : state?.state === "idle" ? styles.dotIdle : styles.dotUnknown]} />
                  <Text style={styles.nodeTitle}>{node.id}</Text>
                </View>
                <Text style={[styles.status, state?.state === "live" && styles.statusLive]}>{status}</Text>
                <Text style={styles.owns}>{node.owns}</Text>
                <Text style={styles.links}>
                  {"Harnesses · " + (node.linkedHarnessIds.join(" · ") || "none declared")}
                </Text>
              </View>
            </PressScale>
            );
          })}
          <View style={styles.inventory}>
            <Text style={styles.inventoryTitle}>Harness catalog</Text>
            <Text style={styles.inventoryText}>
              {catalog.harnesses.map((harness) =>
                harness.id + (harness.kind === "control-room" ? " (control room)" : ""),
              ).join(" · ")}
            </Text>
            <Text style={styles.caption}>{catalog.distro.name} · distro, not a harness</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  toggle: {
    minHeight: 44, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: glass.borderBright,
    backgroundColor: glass.fillRaised, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", gap: space.sm,
  },
  title: { ...type.heading, color: colors.text, flexShrink: 1 },
  toggleLabel: { ...type.small, color: colors.textMuted },
  contents: { gap: space.sm },
  caption: { ...type.small, color: colors.textMuted },
  node: {
    minHeight: 64, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: glass.border, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
  },
  nodeBody: { width: "100%", gap: space.xs, alignItems: "flex-start" },
  nodeHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  nodeTitle: { ...type.heading, color: colors.text },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLive: { backgroundColor: colors.ok },
  dotIdle: { backgroundColor: colors.textTertiary },
  dotUnknown: { borderWidth: 1, borderColor: colors.textTertiary },
  status: { ...type.small, color: colors.textMuted },
  statusLive: { color: colors.ok },
  owns: { ...type.small, color: colors.ink2 },
  links: { ...type.mono, color: colors.textMuted },
  inventory: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: glass.fillRaised },
  inventoryTitle: { ...type.heading, color: colors.text },
  inventoryText: { ...type.small, color: colors.ink2 },
  warning: { ...type.small, color: colors.warn },
});
