import { memo, useMemo, useState } from "react";
import { PanResponder, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReplyPart } from "../../../shared/protocol";
import { detailsOf, readDetails, wrappedTail, type DetailMode } from "../lib/reply-details";
import { replyParts, useKeyed } from "../store/text";
import { colors, glass, type } from "../theme";
import type { SummaryInfo } from "../../../shared/thinking-summary";
import { ThinkingSummaryChip } from "./ThinkingSummaryChip";
import { Tree } from "./Tree";
import { toolTree } from "../lib/tool-tree";
import { ToolInspector } from "./ToolInspector";
import { PressScale } from "./PressScale";
import { Feather } from "@expo/vector-icons";
import { formatTool } from "../../../shared/tool-format";
import { toolProgressLabel } from "../lib/turn-feedback";
import type { ToolView } from "../lib/reply-details";

/** Fixed compact body (3 × 16px) keeps FlashList measurement stable during streaming. */
function WrappedBlock({ label, text, mode, accent = colors.textMuted, children }: { label: string; text: string; mode: DetailMode; accent?: string; children?: React.ReactNode }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_, gesture) => { if (Math.abs(gesture.dx) > 48) setExpanded(false); },
  }), []);
  const open = expanded ?? mode === "Full";
  const lines = text ? text.split("\n").length : 0;
  return <View style={styles.block} {...swipe.panHandlers}>
    <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setExpanded(!open)} onLongPress={() => setExpanded(true)} style={styles.header}>
      <Text style={[styles.chip, { color: accent }]} numberOfLines={1}>{open ? "⌄" : "›"} {label}</Text>
      <Text style={styles.count}>{lines} lines</Text>
    </PressScale>
    {open ? <ScrollView style={[styles.expanded, label === "Thinking" && { maxHeight: 80 }]} nestedScrollEnabled>{children ?? <Text selectable style={styles.output}>{text}</Text>}</ScrollView> : <CompactTail text={text || "Waiting for output…"} />}
  </View>;
}
export const ReplyBlocks = memo(function ReplyBlocks({ turnId, parts, summaries, mode = "Compact", request }: { turnId: string; parts?: ReplyPart[]; summaries?: SummaryInfo[]; mode?: DetailMode; request?: (id: string) => void }) {
  const raw = useKeyed(replyParts, turnId);
  const details = useMemo(() => raw ? readDetails(raw) : detailsOf(parts), [raw, parts]);
  const [selected, setSelected] = useState<string>();
  const nodes = useMemo(() => toolTree({ tools: details.tools, turnId }, setSelected), [details, turnId]);
  const tools = details.tools;
  const selectedTool = tools.find(tool => tool.id === selected);
  if (mode === "Hide") return null;
  const latest = tools.at(-1);
  const accent = details.tools.some(tool => tool.status === "error") ? colors.danger : details.tools.some(tool => tool.status === "live") ? colors.gold : colors.ok;
  return <View style={styles.blocks}>
    {summaries?.filter(summary => summary.kind !== "turn").map(summary => <ThinkingSummaryChip key={summary.blockId} turnId={turnId} summary={summary} />)}
    {details.reasoning ? <WrappedBlock key={`${turnId}:reasoning`} label={`Reasoning · ${summaries?.find(summary => summary.kind !== "turn")?.text || "summary unavailable"}`} text={details.reasoning} mode={mode} /> : null}
    {latest ? <ToolBlock key={`${turnId}:tools`} tools={tools} mode={mode} accent={accent}>
      <Tree inline nodes={nodes} label="Turn details" initialExpanded={[`${turnId}:turn`, `${turnId}:tools`]} />
      {tools.filter(tool => tool.truncated).map(tool => tool.detailLoaded ? <Text key={tool.id} style={styles.summary}>{tool.name}: retained output capped at 1 MiB.</Text> : <PressScale key={tool.id} accessibilityRole="button" disabled={!request} onPress={() => request?.(tool.id)} style={styles.load}><Text style={styles.more}>{tool.name}: Load retained output (up to 1 MiB)</Text></PressScale>)}
    </ToolBlock> : null}
    {selectedTool ? <ToolInspector tool={selectedTool} request={request} close={() => setSelected(undefined)} /> : null}
  </View>;
});
/** Keep the disclosure mounted while output streams; never animate measured height. */
function ToolBlock({ tools, mode, accent, children }: { tools: ToolView[]; mode: DetailMode; accent: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? mode === "Full";
  const latest = tools.findLast(tool => tool.status === "error") ?? tools.at(-1);
  if (!latest) return null;
  const formatted = formatTool({ ...latest, output: latest.output.slice(-4096) });
  return <View style={styles.block}>
    <PressScale accessibilityRole="button" accessibilityLabel="Tool calls" accessibilityHint={toolProgressLabel(tools)} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setExpanded(!open)} style={styles.header}>
      <Feather name={open ? "chevron-down" : "chevron-right"} size={14} color={accent} />
      <Text style={[styles.chip, { color: accent }]} numberOfLines={1}>{toolProgressLabel(tools)}</Text>
      <Text style={styles.count}>{open ? "Less" : "Details"}</Text>
    </PressScale>
    <View style={!open ? styles.hidden : undefined} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"} aria-hidden={!open} pointerEvents={open ? "auto" : "none"}>{children}</View>
    {!open ? <View style={styles.toolPreview}>
      <Text style={styles.toolTitle} numberOfLines={2}>{formatted.title}</Text>
      <CompactTail error={latest.status === "error"} text={formatted.output.trimEnd() || (latest.status === "live" ? "Waiting for output…" : latest.status === "error" ? "Tool failed without output" : "Completed without output")} />
    </View> : null}
  </View>;
}
/** Render a bounded suffix, not a megabyte Text clipped by a tiny viewport. */
function CompactTail({ text, error = false }: { text: string; error?: boolean }) {
  const [columns, setColumns] = useState(40);
  return <View style={styles.preview} onLayout={event => setColumns(Math.max(1, Math.min(160, Math.floor((event.nativeEvent.layout.width - 18) / 6.7))))}>
    <Text selectable numberOfLines={3} style={[styles.output, error && { color: colors.danger }]}>{wrappedTail(text.slice(-4096), columns)}</Text>
  </View>;
}
const styles = StyleSheet.create({
  hidden: { display: "none" },
  toolPreview: { paddingBottom: 6 },
  toolTitle: { ...type.small, color: colors.textMuted, paddingHorizontal: 9, marginBottom: 4 },
  load: { minHeight: 44, paddingHorizontal: 9 },
  blocks: { gap: 6 },
  block: { borderWidth: 1, borderColor: colors.hair, borderRadius: 8, overflow: "hidden", backgroundColor: glass.fill },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, gap: 6 },
  chip: { ...type.mono, fontSize: 11, flexShrink: 1 },
  count: { marginLeft: "auto", ...type.mono, fontSize: 10, color: colors.textTertiary },
  preview: { height: 54, paddingHorizontal: 9, paddingBottom: 6, overflow: "hidden" },
  output: { ...type.mono, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  expanded: { maxHeight: 160, paddingHorizontal: 9, paddingBottom: 8 },
  tool: { borderTopWidth: 1, borderColor: colors.hair, paddingBottom: 8 },
  toolHeader: { minHeight: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summary: { ...type.mono, fontSize: 10, lineHeight: 16, color: colors.textTertiary },
  more: { ...type.small, color: colors.gold, paddingVertical: 8 },
});
