import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReplyPart } from "../../../shared/protocol";
import { detailsOf, readDetails, seconds, toolStackLabel, type DetailMode, type ToolView } from "../lib/reply-details";
import { replyParts, useKeyed } from "../store/text";
import { colors, type } from "../theme";
import type { SummaryInfo } from "../../../shared/thinking-summary";
import { ThinkingSummaryChip } from "./ThinkingSummaryChip";

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
function ToolCall({ tool, full, request }: { tool: ToolView; full: boolean; request?: (id: string) => void }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const color = tool.status === "live" ? colors.gold : tool.status === "ok" ? colors.ok : colors.danger;
  const expanded = open ?? full;
  return <View style={styles.tool}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${tool.name} ${tool.status}`} accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setOpen(!expanded)} onLongPress={() => setOpen(true)} style={styles.toolHeader}>
      <Text style={[styles.chip, { color }]} numberOfLines={1}>{tool.status === "live" ? "●" : tool.status === "ok" ? "✓" : "!"} {tool.name}</Text>
      <Text style={styles.count}>{seconds(tool.durationMs)}</Text>
    </Pressable>
    <Text style={styles.summary} numberOfLines={expanded ? undefined : 1}>{tool.summary}</Text>
    {expanded ? <View>
      <Text selectable style={styles.output}>Args: {tool.args}</Text>
      <Text selectable style={styles.output}>{tool.output || "Waiting for output…"}</Text>
      {tool.truncated && !tool.detailLoaded ? <Pressable accessibilityRole="button" onPress={() => request?.(tool.id)}><Text style={styles.more}>Load retained output (up to 1 MiB)</Text></Pressable> : tool.truncated ? <Text style={styles.summary}>Retained output capped at 1 MiB.</Text> : null}
    </View> : null}
  </View>;
}
export const ReplyBlocks = memo(function ReplyBlocks({ turnId, parts, summaries, mode = "Compact", request }: { turnId: string; parts?: ReplyPart[]; summaries?: SummaryInfo[]; mode?: DetailMode; request?: (id: string) => void }) {
  const raw = useKeyed(replyParts, turnId);
  const started = useRef(new Map<string, number>());
  const [now, setNow] = useState(Date.now);
  const details = useMemo(() => raw ? readDetails(raw) : detailsOf(parts), [raw, parts]);
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
    {details.reasoning ? <WrappedBlock key={`${turnId}:reasoning:${mode}`} label="Thinking" text={details.reasoning} mode={mode} /> : null}
    {latest ? <WrappedBlock key={`${turnId}:tools:${mode}`} label={`${toolStackLabel(tools)} · ${latest.name}`} text={`${latest.name} · ${latest.summary}\n${latest.output}`} mode={mode} accent={accent}>
      {tools.map(tool => <ToolCall key={tool.id} tool={tool} full={mode === "Full"} request={request} />)}
    </WrappedBlock> : null}
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
