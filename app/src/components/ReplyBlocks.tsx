import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReplyPart } from "../../../shared/protocol";
import { detailsOf, readDetails, toolStackLabel, type DetailMode } from "../lib/reply-details";
import { replyParts, useKeyed } from "../store/text";
import { colors, type } from "../theme";
import type { SummaryInfo } from "../../../shared/thinking-summary";
import { ThinkingSummaryChip } from "./ThinkingSummaryChip";
import { Tree } from "./Tree";
import { toolTree } from "../lib/tool-tree";
import { ToolInspector } from "./ToolInspector";

/** Fixed compact body (3 × 16px) keeps FlashList measurement stable during streaming. */
function WrappedBlock({ label, text, mode, accent = colors.textMuted, children }: { label: string; text: string; mode: DetailMode; accent?: string; children?: React.ReactNode }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const tail = useRef<ScrollView>(null);
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_, gesture) => { if (Math.abs(gesture.dx) > 48) setExpanded(false); },
  }), []);
  const open = expanded ?? mode === "Full";
  const lines = text ? text.split("\n").length : 0;
  return <View style={styles.block} {...swipe.panHandlers}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setExpanded(!open)} onLongPress={() => setExpanded(true)} style={styles.header}>
      <Text style={[styles.chip, { color: accent }]} numberOfLines={1}>{open ? "⌄" : "›"} {label}</Text>
      <Text style={styles.count}>{lines} lines</Text>
    </Pressable>
    {open ? <ScrollView style={[styles.expanded, label === "Thinking" && { maxHeight: 80 }]} nestedScrollEnabled>{children ?? <Text selectable style={styles.output}>{text}</Text>}</ScrollView> : <ScrollView ref={tail} scrollEnabled={false} style={styles.preview} onContentSizeChange={() => tail.current?.scrollToEnd({ animated: false })}><Text style={styles.output}>{text.trimEnd() || "Waiting for output…"}</Text></ScrollView>}
  </View>;
}
export const ReplyBlocks = memo(function ReplyBlocks({ turnId, parts, summaries, mode = "Compact", request }: { turnId: string; parts?: ReplyPart[]; summaries?: SummaryInfo[]; mode?: DetailMode; request?: (id: string) => void }) {
  const raw = useKeyed(replyParts, turnId);
  const started = useRef(new Map<string, number>());
  const [now, setNow] = useState(Date.now);
  const details = useMemo(() => raw ? readDetails(raw) : detailsOf(parts), [raw, parts]);
  const [selected, setSelected] = useState<string>();
  const nodes = useMemo(() => toolTree({ tools: details.tools, turnId }, setSelected), [details, turnId]);
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
    {details.reasoning ? <WrappedBlock key={`${turnId}:reasoning:${mode}`} label={`Reasoning · ${summaries?.find(summary => summary.kind !== "turn")?.text || "summary unavailable"}`} text={details.reasoning} mode={mode} /> : null}
    {latest ? <View style={styles.block}>
      <Text style={[styles.chip, { color: accent, padding: 9 }]}>{toolStackLabel(tools)}</Text>
      <Tree inline nodes={nodes} label="Turn details" initialExpanded={[`${turnId}:turn`, `${turnId}:tools`]} />
      {tools.filter(tool => tool.truncated).map(tool => tool.detailLoaded ? <Text key={tool.id} style={styles.summary}>{tool.name}: retained output capped at 1 MiB.</Text> : <Pressable key={tool.id} accessibilityRole="button" onPress={() => request?.(tool.id)}><Text style={styles.more}>{tool.name}: Load retained output (up to 1 MiB)</Text></Pressable>)}
    </View> : null}
    {selected && tools.find(tool => tool.id === selected) ? <ToolInspector tool={tools.find(tool => tool.id === selected)!} request={request} close={() => setSelected(undefined)} /> : null}
  </View>;
});
const styles = StyleSheet.create({
  blocks: { gap: 6 },
  block: { borderWidth: 1, borderColor: colors.hair, borderRadius: 8, overflow: "hidden", backgroundColor: "#0b0c0e" },
  header: { height: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, gap: 6 },
  chip: { ...type.mono, fontSize: 11, flexShrink: 1 },
  count: { ...type.mono, fontSize: 10, color: colors.textTertiary },
  preview: { height: 54, paddingHorizontal: 9, paddingBottom: 6, overflow: "hidden" },
  output: { ...type.mono, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  expanded: { maxHeight: 160, paddingHorizontal: 9, paddingBottom: 8 },
  tool: { borderTopWidth: 1, borderColor: colors.hair, paddingBottom: 8 },
  toolHeader: { minHeight: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summary: { ...type.mono, fontSize: 10, lineHeight: 16, color: colors.textTertiary },
  more: { ...type.small, color: colors.gold, paddingVertical: 8 },
});
