import { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { ShimmerText } from "./ShimmerText";
import { Tree } from "./Tree";
import type { TreeNode } from "../lib/tree";
import type { Settings } from "../model";
import { colors, fonts } from "../theme";
import { haptic } from "../haptics";
import { fetchSessionWorkers, type Worker } from "../lib/session-workers";

/** Poll the session's live workers every 3 s while foregrounded. */
export function useSessionWorkers(settings: Settings | null, online: boolean, profile?: string, session?: string): Worker[] {
  const key = JSON.stringify([settings?.address, profile, session]);
  const [sample, setSample] = useState<{ key: string; workers: Worker[] }>();
  useEffect(() => {
    if (!settings || !online || !profile || !session) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState === "background" || AppState.currentState === "inactive") { timer = setTimeout(poll, 3000); return; }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 2500);
      try {
        const workers = await fetchSessionWorkers(settings, profile, session, controller.signal);
        if (!disposed) setSample({ key, workers });
      } catch { /* Offline or bridge without /hermes/workers: keep the last list until the next poll. */ }
      finally { clearTimeout(timeout); if (!disposed) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [settings, online, profile, session, key]);
  return online && sample?.key === key ? sample.workers : [];
}

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

/** Compressed in-chat view of how many subagents are working and on what. Orchestra keeps the full graph. */
export function WorkersStrip({ workers }: { workers: Worker[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (workers.length === 0) return null;
  const first = workers[0];
  const now = Date.now();
  const doing = (w: Worker) => (w.tool ? `${w.tool}` : w.phase === "streaming" ? "writing" : "thinking");
  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${workers.length} subagents working`}
        onPress={() => { haptic.select(); setOpen(v => !v); }} style={styles.head}>
        <Text style={styles.count}>{workers.length} subagent{workers.length === 1 ? "" : "s"}</Text>
        {first && !open ? <ShimmerText text={`${first.title} · ${doing(first)}${workers.length > 1 ? `  +${workers.length - 1}` : ""}`} size={11} /> : <View style={{ flex: 1 }} />}
        <Text style={styles.chev}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? <Tree inline label="Subagents" nodes={workers.map((w): TreeNode => ({
        id: `worker:${w.id}`, kind: "bot", label: w.title, shimmer: true,
        meta: `${doing(w)} · ${age(now - w.startedAt)}`, status: "running",
      }))} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 6, paddingVertical: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  count: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted },
  line: { fontFamily: fonts.mono, fontSize: 11, color: colors.textTertiary },
  chev: { fontSize: 10, color: colors.textTertiary, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24, paddingLeft: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textTertiary },
  title: { fontSize: 13, color: colors.textMuted },
  meta: { fontFamily: fonts.mono, fontSize: 10, color: colors.textTertiary, marginLeft: "auto" },
});
