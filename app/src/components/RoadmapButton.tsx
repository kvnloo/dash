import { useState } from "react";
import { FlatList, Linking, Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { evidenceCoverage, ROADMAP, ROADMAP_SOURCE, type RoadmapAsk } from "../lib/roadmap-evidence";
import { colors, fonts } from "../theme";
import { PressScale } from "./PressScale";

/** Ephemeral in-app surface: dismissing unmounts it; never an approval or task scheduler. */
export function RoadmapButton() {
  const [open, setOpen] = useState(false);
  return <>
    <PressScale accessibilityRole="button" accessibilityLabel="Open roadmap evidence" onPress={() => setOpen(true)} style={styles.button}><Text style={styles.link}>Roadmap</Text></PressScale>
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="none" presentationStyle="fullScreen">
      {open ? <SafeAreaView style={styles.root}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Roadmap · evidence</Text><PressScale accessibilityRole="button" accessibilityLabel="Close roadmap" onPress={() => setOpen(false)} style={styles.button}><Text style={styles.link}>Close</Text></PressScale></View>
        <Text style={styles.note}>{ROADMAP_SOURCE}</Text>
        <Text style={styles.note}>Bars count verified receipts / declared checks, not feature completion. Missing receipts stay unknown. No phone verification inferred from logs.</Text>
        <Text style={styles.note}>Dash-native ephemeral surface. Ripple integration is not installed.</Text>
        <FlatList data={ROADMAP} keyExtractor={item => item.id} renderItem={({ item }) => <AskRow item={item} />} contentContainerStyle={styles.list} />
      </SafeAreaView> : null}
    </Modal>
  </>;
}
function AskRow({ item }: { item: RoadmapAsk }) {
  const [expanded, setExpanded] = useState(false);
  const coverage = evidenceCoverage(item.checks);
  return <View style={styles.ask} testID={`roadmap-${item.id}`}>
    <PressScale accessibilityRole="button" accessibilityLabel={`${item.title}, ${coverage.verified} of ${coverage.declared} checks verified`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.row}>
      <Text style={styles.heading}>{item.title}</Text><Text style={styles.note}>{coverage.verified}/{coverage.declared} verified {expanded ? "−" : "+"}</Text>
    </PressScale>
    <View accessibilityRole="progressbar" accessibilityLabel={`${item.title} evidence coverage`} accessibilityValue={{ min: 0, max: coverage.declared, now: coverage.verified, text: `${coverage.verified} of ${coverage.declared} declared checks verified` }} style={styles.track}><View style={[styles.fill, { width: `${coverage.ratio * 100}%` }]} /></View>
    {expanded ? <View style={styles.details}>
      <Text selectable style={styles.quote}>Request (archived scope): “{item.ask}”</Text>
      {item.blocker ? <Text style={styles.blocker}>{item.blocker}</Text> : null}
      {item.checks.map(check => <View key={check.id} style={styles.check}><Text style={styles.note}>{check.status} · {check.label}</Text>{check.receipt ? <PressScale accessibilityRole="link" accessibilityLabel={`Open receipt for ${check.label}`} onPress={() => { void Linking.openURL(check.receipt!.url); }} style={styles.button}><Text selectable style={styles.link}>{check.receipt.label}</Text></PressScale> : <Text style={styles.note}>No receipt attached</Text>}{check.note ? <Text style={styles.note}>{check.note}</Text> : null}</View>)}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 20 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
  heading: { color: colors.text, fontSize: 14, flex: 1 },
  link: { color: colors.text, fontSize: 11 },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  list: { padding: 16, gap: 12 },
  ask: { paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.border, gap: 6 },
  row: { minHeight: 44, flexDirection: "row", gap: 12, alignItems: "center" },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 3, backgroundColor: colors.textMuted },
  details: { gap: 12, paddingVertical: 8 },
  quote: { color: colors.text, fontSize: 12, lineHeight: 18 },
  check: { gap: 2 },
  blocker: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
