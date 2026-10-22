import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { LiveIntent } from "../../../../shared/live";
import type { Widget } from "../../lib/genui";
import { colors, glass, radius, type } from "../../theme";
import { PressScale } from "../PressScale";

export function GenUI({ widgets, onIntent }: { widgets: Widget[]; onIntent?: (intent: LiveIntent) => boolean }) {
  return <View style={{ gap: 10, marginVertical: 8 }}>{widgets.map((widget, i) => <WidgetView key={i} widget={widget} onIntent={onIntent} />)}</View>;
}
function WidgetView({ widget: w, onIntent }: { widget: Widget; onIntent?: (intent: LiveIntent) => boolean }) {
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const choose = (item: NonNullable<Widget["items"]>[number]) => {
    if (!w.id || !onIntent) return;
    const checked = !(selected[item.id] ?? item.checked ?? false);
    const ok = onIntent({ controlId: w.id, value: w.type === "checklist" ? `${item.id}:${checked}` : item.id, label: item.label.slice(0, 120), surface: "dash-inline-genui" });
    if (ok) setSelected(s => ({ ...s, [item.id]: checked }));
    setNotice(ok ? `Sent: ${item.label}` : "Not sent · agent busy or offline. Try again.");
  };
  if (w.type === "progress") return <View style={styles.progressRow} accessibilityLabel={`${w.title}: ${w.value}%`}>
    <View style={styles.progressHeader}><Text style={styles.progressTitle}>{w.title}</Text><Text style={styles.progressValue}>{w.value}%</Text></View>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Number(w.value) }} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(w.value)} style={styles.track}><View style={{ height: 4, borderRadius: 2, width: `${Number(w.value)}%`, backgroundColor: colors.gold }} /></View>
    {w.text ? <Text selectable style={styles.progressDetail}>{w.text}</Text> : null}
  </View>;
  return <View style={[styles.card, w.children?.every(child => child.type === "progress") && styles.progressGroup]} accessibilityLabel={`${w.type}: ${w.title}`}>

    <Text style={styles.title}>{w.title}</Text>
    {w.text ? <Text selectable style={styles.body}>{w.text}</Text> : null}
    {w.type === "stat" ? <Text style={styles.stat}>{w.value}</Text> : null}

    {w.type === "table" ? <ScrollView horizontal><View role="table">
      {[w.columns ?? [], ...(w.rows ?? [])].map((row, i) => <View key={i} role="row" style={styles.row}>{row.map((cell, j) => <Text key={j} role={i === 0 ? "columnheader" : "cell"} selectable style={[styles.cell, i === 0 && styles.header]}>{cell}</Text>)}</View>)}
    </View></ScrollView> : null}
    {w.items?.map(item => w.type === "timeline" ? <View key={item.id} style={styles.timeline}><Text style={styles.body}>●  {item.label}</Text>{item.detail ? <Text style={styles.meta}>{item.detail}</Text> : null}</View> :
      <PressScale key={item.id} accessibilityRole={w.type === "checklist" ? "checkbox" : "button"} accessibilityLabel={item.label} accessibilityState={{ disabled: !onIntent, checked: selected[item.id] ?? item.checked ?? false }} aria-checked={w.type === "checklist" ? selected[item.id] ?? item.checked ?? false : undefined} aria-disabled={!onIntent} disabled={!onIntent} onPress={() => choose(item)} style={[styles.option, selected[item.id] && { borderColor: colors.gold }]}>
        <Text style={styles.body}>{w.type === "checklist" ? (selected[item.id] ?? item.checked ? "☑ " : "☐ ") : ""}{item.label}</Text>{item.detail ? <Text style={styles.meta}>{item.detail}</Text> : null}
      </PressScale>)}
    {w.children ? <GenUI widgets={w.children} onIntent={onIntent} /> : null}
    {notice ? <Text role="status" style={styles.meta}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  progressGroup: { padding: 0, borderWidth: 0, backgroundColor: "transparent", gap: 2 },
  progressRow: { paddingVertical: 10, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair, minWidth: 0 },
  progressHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  progressTitle: { ...type.body, fontSize: 14, lineHeight: 19, color: colors.text, flex: 1, minWidth: 0 },
  progressValue: { ...type.mono, fontSize: 11, lineHeight: 19, color: colors.textMuted, flexShrink: 0 },
  progressDetail: { ...type.small, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  card: { borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight, borderRadius: radius.md, backgroundColor: glass.fill, padding: 12, gap: 8 },
  title: { ...type.heading, color: colors.text }, body: { ...type.body, color: colors.text }, meta: { ...type.small, color: colors.textMuted },
  stat: { ...type.number, color: colors.gold }, track: { backgroundColor: glass.quiet, borderRadius: 3 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: glass.hair }, cell: { ...type.small, color: colors.text, width: 140, padding: 10 }, header: { color: colors.gold, ...type.label },
  option: { minHeight: 44, padding: 10, borderRadius: radius.card, borderWidth: 1, borderColor: glass.hair, justifyContent: "center" },
  timeline: { borderLeftWidth: 1, borderColor: colors.goldLo, paddingLeft: 10, paddingBottom: 10 },
});
