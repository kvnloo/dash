import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
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

/** Product catalog alongside the separate observed Fleet/Lineage/Work/Triage graph. */
export function AodlCatalogNetwork() {
  const [expanded, setExpanded] = useState(true);
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
        <Text style={styles.title}>AODL network · catalog</Text>
        <Text style={styles.toggleLabel}>{expanded ? "Hide" : "Show"}</Text>
      </PressScale>
      {expanded && !catalog ? (
        <Text style={styles.warning} accessibilityRole="alert">
          Pinned AODL catalog is invalid. Network hidden.
        </Text>
      ) : null}
      {expanded && catalog ? (
        <View style={styles.contents}>
          <Text style={styles.caption}>Static product ownership · not live sessions or execution status</Text>
          {catalog.nodes.map((node) => (
            <PressScale
              key={node.id}
              accessibilityRole="link"
              accessibilityLabel={
                node.id + ". Owns: " + node.owns + ". Linked harnesses: " +
                (node.linkedHarnessIds.join(", ") || "none declared")
              }
              accessibilityHint="Open repository on GitHub"
              onPress={() => { void Linking.openURL(node.repo); }}
              style={styles.node}
            >
              <View style={styles.nodeBody}>
                <Text style={styles.nodeTitle}>{node.id}</Text>
                <Text style={styles.owns}>{node.owns}</Text>
                <Text style={styles.links}>
                  {"Harnesses · " + (node.linkedHarnessIds.join(" · ") || "none declared")}
                </Text>
              </View>
            </PressScale>
          ))}
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
  nodeTitle: { ...type.heading, color: colors.text },
  owns: { ...type.small, color: colors.ink2 },
  links: { ...type.mono, color: colors.textMuted },
  inventory: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: glass.fillRaised },
  inventoryTitle: { ...type.heading, color: colors.text },
  inventoryText: { ...type.small, color: colors.ink2 },
  warning: { ...type.small, color: colors.warn },
});
