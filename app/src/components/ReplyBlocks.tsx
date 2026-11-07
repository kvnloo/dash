import { Feather } from "@expo/vector-icons";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReplyPart } from "../../../shared/protocol";
import { detailsOf, readDetails, toolStackLabel, type DetailMode, type ToolView } from "../lib/reply-details";
import { compactGroup, compactToolRow } from "../lib/compact-tool-row";
import { replyParts, useKeyed } from "../store/text";
import { colors, space, type } from "../theme";
import type { SummaryInfo } from "../../../shared/thinking-summary";
import { CompactToolRow } from "./CompactToolRow";
import { ThinkingSummaryChip } from "./ThinkingSummaryChip";
import { ToolInspector } from "./ToolInspector";

/** Reasoning: one quiet row (documented text: "Reasoning · <summary or summary unavailable>"), nothing else while folded. A fixed row keeps FlashList measurement stable during streaming. */
function ThinkingRow({ label, text, mode }: { label: string; text: string; mode: DetailMode }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_, gesture) => { if (Math.abs(gesture.dx) > 48) setExpanded(false); },
  }), []);
  const open = expanded ?? mode === "Full";
  return <View testID="reply-thinking" {...swipe.panHandlers}>
    <Pressable testID="reply-thinking-toggle" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setExpanded(!open)} onLongPress={() => setExpanded(true)} hitSlop={HIT_SLOP} style={styles.toggle}>
      <Feather name={open ? "chevron-down" : "chevron-right"} size={12} color={colors.textTertiary} />
      <Text style={styles.quiet} numberOfLines={1}>{label}</Text>
    </Pressable>
    {open ? <ScrollView style={styles.thinkingBody} nestedScrollEnabled><Text selectable style={styles.output}>{text}</Text></ScrollView> : null}
  </View>;
}

/** A short stack shows its rows at a glance; a longer one folds to its header. Full detail mode always opens. */
const GLANCE_ROWS = 3;

/** Tool calls: one header row, then one dense line per call; adjacent identical calls share a line that lists them on tap. */
function ToolStack({ tools, mode, accent, select, request }: { tools: ToolView[]; mode: DetailMode; accent: string; select(id: string): void; request?: (id: string) => void }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [listed, setListed] = useState<ReadonlySet<string>>(new Set());
  const groups = compactGroup(tools);
  const open = expanded ?? (mode === "Full" || groups.length <= GLANCE_ROWS);
  const label = toolStackLabel(tools);
  const toggle = (id: string) => setListed(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  return <View testID="reply-tools">
    <Pressable testID="reply-tools-toggle" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setExpanded(!open)} hitSlop={HIT_SLOP} style={styles.toggle}>
      <Feather name={open ? "chevron-down" : "chevron-right"} size={12} color={accent} />
      <Text style={[styles.chip, { color: accent }]} numberOfLines={1}>{label}</Text>
    </Pressable>
    {open ? <View style={styles.rail}>
      {groups.map(row => {
        const indexes = row.toolIndexes ?? [];
        const first = tools[indexes[0] ?? 0];
        if (!first) return null;
        if (indexes.length < 2) return <CompactToolRow key={first.id} testID="reply-tool-row" model={row} onExpand={() => select(first.id)} />;
        const shown = listed.has(first.id);
        return <View key={first.id}>
          <CompactToolRow testID="reply-tool-row" model={row} expanded={shown} onExpand={() => toggle(first.id)} />
          {shown ? <View style={[styles.rail, styles.calls]}>{indexes.map(index => {
            const call = tools[index];
            return call ? <CompactToolRow key={call.id} testID="reply-tool-call" model={compactToolRow(call)} onExpand={() => select(call.id)} /> : null;
          })}</View> : null}
        </View>;
      })}
      {tools.filter(tool => tool.truncated).map(tool => tool.detailLoaded ? <Text key={tool.id} style={styles.summary}>{tool.name}: retained output capped at 1 MiB.</Text> : <Pressable key={tool.id} accessibilityRole="button" onPress={() => request?.(tool.id)}><Text style={styles.more}>{tool.name}: Load retained output (up to 1 MiB)</Text></Pressable>)}
    </View> : null}
  </View>;
}
export const ReplyBlocks = memo(function ReplyBlocks({ turnId, parts, summaries, mode = "Compact", request }: { turnId: string; parts?: ReplyPart[]; summaries?: SummaryInfo[]; mode?: DetailMode; request?: (id: string) => void }) {
  const raw = useKeyed(replyParts, turnId);
  const started = useRef(new Map<string, number>());
  const [now, setNow] = useState(Date.now);
  const details = useMemo(() => raw ? readDetails(raw) : detailsOf(parts), [raw, parts]);
  const [selected, setSelected] = useState<string>();
  const live = details.tools.some(tool => tool.status === "live");
  useEffect(() => { if (!live) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [live]);
  const tools = details.tools.map(tool => {
    if (tool.status !== "live") return tool;
    const start = started.current.get(tool.id) ?? Date.now(); started.current.set(tool.id, start);
    return { ...tool, durationMs: Math.max(0, now - start) };
  });
  if (mode === "Hide") return null;
  const latest = tools.at(-1);
  const accent = details.tools.some(tool => tool.status === "error") ? colors.danger : details.tools.some(tool => tool.status === "live") ? colors.gold : colors.ok;
  return <View style={styles.blocks}>
    {summaries?.filter(summary => summary.kind !== "turn").map(summary => <ThinkingSummaryChip key={summary.blockId} turnId={turnId} summary={summary} />)}
    {details.reasoning ? <ThinkingRow key={`${turnId}:reasoning:${mode}`} label={`Reasoning · ${summaries?.find(summary => summary.kind !== "turn")?.text || "summary unavailable"}`} text={details.reasoning} mode={mode} /> : null}
    {latest ? <ToolStack key={`${turnId}:tools:${mode}`} tools={tools} mode={mode} accent={accent} select={setSelected} request={request} /> : null}
    {selected && tools.find(tool => tool.id === selected) ? <ToolInspector tool={tools.find(tool => tool.id === selected)!} request={request} close={() => setSelected(undefined)} /> : null}
  </View>;
});
// A quiet row is 32 px tall; 6 px of vertical slop makes the 44 px touch target (DESIGN.md), and the 8 px gap
// between blocks is the most the rows can give without going back to the bulky cards.
const HIT_SLOP = { top: 6, bottom: 6 } as const;
const styles = StyleSheet.create({
  blocks: { gap: space.sm },
  toggle: { height: 32, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 6 },
  thinkingBody: { maxHeight: 120, marginLeft: 5, paddingLeft: 12, borderLeftWidth: 1, borderColor: colors.hair },
  rail: { marginLeft: 5, borderLeftWidth: 1, borderColor: colors.hair },
  calls: { marginLeft: space.md },
  chip: { ...type.mono, fontSize: 11, flexShrink: 1 },
  quiet: { ...type.mono, fontSize: 11, color: colors.textTertiary, flexShrink: 1 },
  output: { ...type.mono, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  summary: { ...type.mono, fontSize: 10, lineHeight: 16, color: colors.textTertiary, paddingHorizontal: 9 },
  more: { ...type.small, color: colors.gold, paddingVertical: 6, paddingHorizontal: 9 },
});
