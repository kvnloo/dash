import { memo, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { ShimmerText } from "./ShimmerText";
import { Tree } from "./Tree";
import type { TreeNode } from "../lib/tree";
import type { Settings } from "../model";
import { colors, fonts } from "../theme";
import { haptic } from "../haptics";
import { executionToken } from "../lib/bridge-auth";

/** One delegated worker, as reported by the bridge's /hermes/workers (status only, never transcript). */
export type Worker = { id: string; title: string; phase: string; tool?: string; startedAt: number; lastActivityAt: number };

export function parseWorkers(value: unknown): Worker[] {
  if (typeof value !== "object" || value === null || !("workers" in value) || !Array.isArray(value.workers)) return [];
  const out: Worker[] = [];
  for (const w of value.workers) {
    if (typeof w !== "object" || w === null) continue;
    const id = "id" in w && typeof w.id === "string" ? w.id : undefined;
    const title = "title" in w && typeof w.title === "string" ? w.title : undefined;
    const phase = "phase" in w && typeof w.phase === "string" ? w.phase : "thinking";
    const tool = "tool" in w && typeof w.tool === "string" ? w.tool : undefined;
    const startedAt = "startedAt" in w && typeof w.startedAt === "number" ? w.startedAt : 0;
    const lastActivityAt = "lastActivityAt" in w && typeof w.lastActivityAt === "number" ? w.lastActivityAt : 0;
    if (id && title) out.push({ id, title, phase, ...(tool ? { tool } : {}), startedAt, lastActivityAt });
  }
  return out;
}

/** Poll the session's live workers every 3 s while foregrounded. */
export function useSessionWorkers(settings: Settings | null, online: boolean, profile?: string, session?: string): Worker[] {
  const [workers, setWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    if (!settings || !online || !profile || !session) { setWorkers([]); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState !== "active") { timer = setTimeout(poll, 3000); return; }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${settings.address}/hermes/workers?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!disposed) setWorkers(response.ok ? parseWorkers(await response.json()) : []);
      } catch { if (!disposed) setWorkers([]); }
      finally { clearTimeout(timeout); if (!disposed) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [settings, online, profile, session]);
  return workers;
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
