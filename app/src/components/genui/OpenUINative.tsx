import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, glass, radius, space, type } from "../../theme";
import { RippleRoadmap } from "./RippleRoadmap";
import { layoutModel } from "./openui-native-model";
import type { OpenUINode, OpenUILayoutRow } from "./openui-native-model";

const ROOT = "__openui_root__";

function toneColor(tone: string | undefined): string {
  switch (tone) {
    case "muted": return colors.textMuted;
    case "accent": return colors.gold;
    case "warning":
    case "warn": return colors.warn;
    case "danger":
    case "error": return colors.danger;
    case "success":
    case "ok": return colors.ok;
    case "info":
    case "information": return colors.information;
    default: return colors.text;
  }
}

function NativeRow({ row, childrenByParent }: { row: OpenUILayoutRow; childrenByParent: Map<string, OpenUILayoutRow[]> }) {
  const children = childrenByParent.get(row.key) ?? [];
  const descendants = children.map(child => <NativeRow key={child.key} row={child} childrenByParent={childrenByParent} />);

  switch (row.type) {
    case "Stack":
      return <View style={styles.stack}>{descendants}</View>;
    case "Card":
      return <View style={styles.card}>
        <Text selectable accessibilityRole="header" accessibilityLabel={row.accessibilityLabel} style={styles.heading}>{row.title}</Text>
        {descendants}
      </View>;
    case "Text":
      return <Text selectable accessibilityLabel={row.accessibilityLabel} style={[styles.body, { color: toneColor(row.tone) }]}>{row.value}</Text>;
    case "Stat":
      return <View style={styles.card}>
        <Text selectable accessibilityLabel={row.accessibilityLabel} style={styles.statLine}>
          <Text style={styles.label}>{row.label}: </Text>
          <Text style={styles.statValue}>{row.value}</Text>
        </Text>
      </View>;
    case "Progress": {
      const percent = Math.round(row.value * 100);
      return <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={row.accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={styles.card}
      >
        <View style={styles.progressHeader}>
          <Text selectable style={styles.body}>{row.label}</Text>
          <Text selectable style={styles.progressPercent}>{percent}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
      </View>;
    }
    case "List":
      return <View style={styles.card}>
        <Text selectable accessibilityRole="header" accessibilityLabel={row.accessibilityLabel} style={styles.label}>List</Text>
        {row.items.map((item, index) => <View key={index} style={styles.listRow}>
          <Text selectable accessibilityLabel={`Item ${index + 1}: ${item}`} style={styles.body}>{`• ${item}`}</Text>
        </View>)}
      </View>;
    case "Table":
      return <View style={styles.card}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          accessibilityLabel={`${row.accessibilityLabel}, scroll horizontally`}
          showsHorizontalScrollIndicator
        >
          <View role="table">
            <View role="row" style={styles.tableRow}>
              {row.columns.map((column, index) => <Text key={index} selectable role="columnheader" style={styles.tableHeader}>{column}</Text>)}
            </View>
            {row.rows.map((cells, index) => <View key={index} role="row" style={styles.tableRow}>
              {cells.map((cell, cellIndex) => <Text key={cellIndex} selectable role="cell" style={styles.tableCell}>{cell}</Text>)}
            </View>)}
          </View>
        </ScrollView>
      </View>;
    case "Callout":
      return <View style={[styles.card, styles.callout, { borderLeftColor: toneColor(row.tone) }]}>
        <Text selectable accessibilityLabel={row.accessibilityLabel} style={[styles.body, { color: toneColor(row.tone) }]}>{row.text}</Text>
      </View>;
    case "Roadmap":
      return row.handle === "dash-roadmap"
        ? <View style={styles.card}><RippleRoadmap /></View>
        : <Text accessibilityRole="alert" selectable style={styles.body}>Unsupported roadmap</Text>;
  }
}

/** Native-only, display-only OpenUI tree. Mounting in GenerativeBlock is Hermes-owned. */
export function OpenUINative({ tree }: { tree: OpenUINode }) {
  const childrenByParent = useMemo(() => {
    const map = new Map<string, OpenUILayoutRow[]>();
    for (const row of layoutModel(tree)) {
      const parent = row.parentKey ?? ROOT;
      const siblings = map.get(parent) ?? [];
      siblings.push(row);
      map.set(parent, siblings);
    }
    return map;
  }, [tree]);

  return <View style={styles.root}>
    {(childrenByParent.get(ROOT) ?? []).map(row => <NativeRow key={row.key} row={row} childrenByParent={childrenByParent} />)}
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bg, marginVertical: space.sm, gap: space.sm },
  stack: { gap: space.sm },
  card: {
    padding: space.md,
    gap: space.sm,
    backgroundColor: glass.fill,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.hair,
    borderTopColor: glass.highlight,
    minWidth: 0,
  },
  heading: { fontSize: type.heading.fontSize, lineHeight: type.heading.lineHeight, fontWeight: "600", color: colors.text },
  body: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: colors.text, flexShrink: 1 },
  label: { fontSize: type.label.fontSize, lineHeight: type.label.lineHeight, fontWeight: "600", letterSpacing: type.label.letterSpacing, color: colors.textMuted },
  statLine: { fontSize: type.body.fontSize, lineHeight: 32, color: colors.text, minHeight: 44, textAlignVertical: "center" },
  statValue: { fontSize: 26, lineHeight: 32, fontWeight: "600", color: colors.text },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm, minHeight: 44 },
  progressPercent: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  progressTrack: { height: 6, backgroundColor: glass.quiet, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.gold, borderRadius: 3 },
  listRow: { minHeight: 44, justifyContent: "center", paddingVertical: space.xs },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.hair },
  tableCell: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: colors.text, minWidth: 132, maxWidth: 220, padding: space.md, minHeight: 44 },
  tableHeader: { fontSize: type.label.fontSize, lineHeight: type.label.lineHeight, fontWeight: "600", letterSpacing: type.label.letterSpacing, color: colors.gold, minWidth: 132, maxWidth: 220, padding: space.md, minHeight: 44 },
  callout: { borderLeftWidth: 3 },
});
