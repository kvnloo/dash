import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { memo, useMemo, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { parseHostUtilization, parsePhoneQueueSnapshot, type AgentInfo, type HostInfo, type HostUtilization, type PhoneQueueJob } from "../../../../shared/protocol";
import type { RootStackParamList } from "../../navigation";
import { deskPrefs, type DeskPanelId } from "../../lib/desk";
import { hostLabel } from "../../lib/hosts-tree";
import { profileFromAgent } from "../../lib/roster";
import { useBridgeJson } from "../../lib/use-bridge-json";
import { RUNNING_BUILD, shortSha } from "../../lib/live-update";
import { SERVED_BUILD, TURBO } from "../../turbo";
import { timeAgo } from "../../util";
import { approvals, actionable, itemTitle } from "../../store/approvals";
import { permissionRequests } from "../../net/bridge";
import { openAgentConversation, setActive, store } from "../../store/app";
import { HostStatsRow } from "../HostStatsRow";
import { TraceEntryCard } from "../trace/TraceEntryCard";
import { DeskPanel, deskStyles as s } from "./DeskPanel";
import { colors, space } from "../../theme";

type Nav = NavigationProp<RootStackParamList>;
type PanelLayout = (id: DeskPanelId, y: number) => void;

function HoverRow({ onPress, label, testID, children }: { onPress?(): void; label: string; testID?: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  if (!onPress) return <View testID={testID} accessibilityLabel={label} style={s.row}>{children}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={[s.row, hover && s.rowHover]}>{children}</Pressable>;
}

const pct = (n: number | undefined) => n === undefined ? "–" : `${Math.round(n)}%`;
const hours = (ms: number) => ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${Math.max(0, Math.round(ms / 60_000))} min`;

/** Utilization over the window: sample-weighted averages and time spent maxed out (CPU or GPU ≥ threshold). */
export function utilizationSummary(u: HostUtilization) {
  let samples = 0, busy = 0, cpuSum = 0, cpuN = 0, gpuSum = 0, gpuN = 0;
  for (const b of u.buckets) {
    samples += b.samples; busy += b.busy;
    if (b.cpuAvg !== undefined) { cpuSum += b.cpuAvg * b.samples; cpuN += b.samples; }
    if (b.gpuAvg !== undefined) { gpuSum += b.gpuAvg * b.samples; gpuN += b.samples; }
  }
  return {
    coveredMs: samples * u.sampleMs,
    busyMs: busy * u.sampleMs,
    busyPct: samples ? (100 * busy) / samples : 0,
    cpuAvg: cpuN ? cpuSum / cpuN : undefined,
    gpuAvg: gpuN ? gpuSum / gpuN : undefined,
  };
}

const STRIP_SLOTS = 48;
const STRIP_HEIGHT = 28;
function UtilizationStrip({ u }: { u: HostUtilization }) {
  const summary = utilizationSummary(u);
  // Fold buckets into fixed slots across the window; empty slots are gaps, not zero.
  const slots = useMemo(() => {
    const slotMs = u.windowMs / STRIP_SLOTS, start = u.sampledAt - u.windowMs;
    const out: ({ cpu: number; busy: boolean } | null)[] = Array.from({ length: STRIP_SLOTS }, () => null);
    const acc = Array.from({ length: STRIP_SLOTS }, () => ({ n: 0, sum: 0, busy: 0 }));
    for (const b of u.buckets) {
      const i = Math.min(STRIP_SLOTS - 1, Math.floor((b.at - start) / slotMs));
      const slot = acc[i];
      if (i < 0 || !slot || b.cpuAvg === undefined) continue;
      slot.n += b.samples; slot.sum += b.cpuAvg * b.samples; slot.busy += b.busy;
    }
    acc.forEach((a, i) => { if (a.n) out[i] = { cpu: a.sum / a.n, busy: a.busy > 0 }; });
    return out;
  }, [u]);
  return <View testID="desk-utilization" style={styles.util}>
    <Text style={s.mono} testID="desk-utilization-summary">
      {`${hours(u.windowMs)} window · busy ${hours(summary.busyMs)} (${Math.round(summary.busyPct)}% of ${hours(summary.coveredMs)} sampled) · CPU avg ${pct(summary.cpuAvg)}${summary.gpuAvg !== undefined ? ` · GPU avg ${pct(summary.gpuAvg)}` : ""}`}
    </Text>
    <View style={styles.strip} accessibilityLabel={`CPU utilization over ${hours(u.windowMs)}, ${u.buckets.length} buckets`}>
      {slots.map((slot, i) => <View key={i} style={styles.slot}>
        {slot ? <View style={[styles.bar, { height: Math.max(1, Math.round(STRIP_HEIGHT * slot.cpu / 100)), backgroundColor: slot.busy ? colors.warn : colors.goldLo }]} /> : null}
      </View>)}
    </View>
    <Text style={s.faint}>{`since ${timeAgo(u.since)} · ${u.buckets.length} × ${hours(u.bucketMs)} buckets · busy = CPU or GPU ≥ ${u.busyThresholdPct}%`}</Text>
  </View>;
}

function runningAgents(host: HostInfo): AgentInfo[] { return host.agents.filter(a => a.status === "running"); }

export const DeskHostsPanel = memo(function DeskHostsPanel({ onLayout }: { onLayout: PanelLayout }) {
  const hosts = store.use(st => st.connection.hosts);
  const open = deskPrefs.use(st => st.collapsed.hosts !== true);
  const self = hosts.find(h => h.self && h.online);
  const util = useBridgeJson("/hosts/utilization", parseHostUtilization, 30_000, open && Boolean(self));
  const ordered = useMemo(() => [...hosts].sort((a, b) => Number(b.self) - Number(a.self) || Number(b.online) - Number(a.online) || hostLabel(a).localeCompare(hostLabel(b))), [hosts]);
  return <DeskPanel id="hosts" title="Hosts" meta={`${hosts.filter(h => h.online).length}/${hosts.length} online`} onLayout={onLayout}>
    {ordered.length === 0 ? <Text style={s.empty}>No hosts in the roster yet.</Text> : null}
    {ordered.map(host => {
      const running = runningAgents(host).length;
      return <View key={host.id} testID={`desk-host-${host.id}`} style={styles.host}>
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: host.online ? colors.ok : colors.textFaint }]} />
          <Text style={s.name} numberOfLines={1}>{hostLabel(host)}</Text>
          <Text style={s.pill}>{host.kind ?? "computer"}{host.self ? " · this bridge" : ""}</Text>
          <Text style={s.faint}>{host.online ? `${running} running · ${host.agents.length} agents` : host.lastSeen ? `seen ${timeAgo(Date.parse(host.lastSeen))}` : "offline"}</Text>
        </View>
        {host.self && host.online ? <View style={styles.indent}>
          <HostStatsRow hostId={host.id} showNet />
          {util.data && util.data.hostId === host.id ? <UtilizationStrip u={util.data} />
            : <Text style={s.faint}>{util.error ? `Utilization history unavailable (${util.error})` : "Loading utilization…"}</Text>}
        </View> : <Text style={[s.faint, styles.indent]}>{host.kind === "phone" ? "Live stats come from the phone queue panel." : "This bridge does not expose stats for remote hosts."}</Text>}
      </View>;
    })}
  </DeskPanel>;
});

const STATE_ORDER = ["running", "claimed", "queued", "pending", "waiting", "blocked", "failed", "done"];
function jobLine(job: PhoneQueueJob): string {
  return [job.device, job.kind, job.agent, job.updatedAt ?? job.createdAt ? timeAgo(job.updatedAt ?? job.createdAt ?? 0) : undefined].filter(Boolean).join(" · ");
}

export const DeskPhoneQueuePanel = memo(function DeskPhoneQueuePanel({ onLayout }: { onLayout: PanelLayout }) {
  const open = deskPrefs.use(st => st.collapsed.phones !== true);
  const queue = useBridgeJson("/phones/queue", parsePhoneQueueSnapshot, 10_000, open);
  const data = queue.data;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of data?.jobs ?? []) map.set(job.state, (map.get(job.state) ?? 0) + 1);
    const rank = (state: string) => { const i = STATE_ORDER.indexOf(state); return i < 0 ? STATE_ORDER.length : i; };
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [data]);
  const jobs = useMemo(() => [...(data?.jobs ?? [])].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)).slice(0, 12), [data]);
  return <DeskPanel id="phones" title="Phone queue" meta={data?.reachable ? `${data.devices.length} devices · ${data.jobs.length} jobs` : undefined} onLayout={onLayout}>
    {!data ? <Text style={queue.error ? s.alert : s.empty} accessibilityRole={queue.error ? "alert" : "text"}>{queue.error ? `Phone queue unavailable from this bridge (${queue.error}).` : "Reading the phone queue…"}</Text>
      : !data.reachable ? <Text testID="desk-phone-queue-down" accessibilityRole="alert" style={s.alert}>{`${data.error ?? "Phone queue unreachable"}. Jobs stay queued on the service; nothing is sent from here.`}</Text>
      : <>
        {data.error ? <Text style={s.alert}>{data.error}</Text> : null}
        {data.devices.map(device => <View key={device.id} testID={`desk-phone-${device.id}`} style={s.row}>
          <View style={[s.dot, { backgroundColor: device.ownerActive ? colors.warn : /idle|ready|free/i.test(device.state) ? colors.ok : /off|down|error/i.test(device.state) ? colors.danger : colors.information }]} />
          <Text style={s.name} numberOfLines={1}>{device.name}</Text>
          <Text style={s.pill}>{device.ownerActive ? "owner using" : device.state}</Text>
          <Text style={s.faint} numberOfLines={1}>{[device.batteryPct !== undefined ? `battery ${Math.round(device.batteryPct)}%` : undefined, device.queued !== undefined ? `${device.queued} queued` : undefined, device.foreground, device.detail].filter(Boolean).join(" · ")}</Text>
        </View>)}
        {counts.length ? <Text testID="desk-phone-job-counts" style={[s.mono, styles.indent]}>{counts.map(([state, n]) => `${n} ${state}`).join(" · ")}</Text> : <Text style={s.empty}>No phone jobs.</Text>}
        {jobs.map(job => <View key={job.id} testID={`desk-phone-job-${job.id}`} style={s.row}>
          <Text style={s.pill}>{job.state}</Text>
          <Text style={s.name} numberOfLines={1}>{job.title ?? job.id}</Text>
          <Text style={s.faint} numberOfLines={1}>{jobLine(job)}</Text>
        </View>)}
        <Text style={[s.faint, styles.indent]}>{`via bridge · ${data.source} · ${timeAgo(data.fetchedAt)}`}</Text>
      </>}
  </DeskPanel>;
});

const project = (cwd: string | undefined) => cwd?.split(/[\\/]/).filter(Boolean).at(-1);

export const DeskWorkersPanel = memo(function DeskWorkersPanel({ onLayout }: { onLayout: PanelLayout }) {
  const navigation = useNavigation<Nav>();
  const hosts = store.use(st => st.connection.hosts);
  const live = useMemo(() => hosts.flatMap(host => runningAgents(host).map(agent => ({ host, agent }))), [hosts]);
  return <DeskPanel id="workers" title="Workers" meta={`${live.length} live`} onLayout={onLayout}>
    {live.length === 0 ? <Text style={s.empty}>No live agent sessions on the roster.</Text> : null}
    {live.map(({ host, agent }) => {
      const where = project(agent.cwd);
      return <HoverRow key={`${host.id}:${agent.id}`} testID={`desk-worker-${agent.id}`} label={`Open ${agent.name} on ${hostLabel(host)}${where ? `, project ${where}` : ""}`}
        onPress={agent.sessionId && host.online ? () => {
          const result = openAgentConversation(profileFromAgent(host, agent));
          if ("error" in result) { Alert.alert("Session unavailable", result.error); return; }
          navigation.navigate("Chat");
        } : undefined}>
        <View style={[s.dot, { backgroundColor: colors.gold }]} />
        <Text style={s.name} numberOfLines={1}>{agent.name}</Text>
        <Text style={s.pill}>{agent.kind}</Text>
        <Text style={s.faint} numberOfLines={1}>{[where ? `on ${where}` : "project unknown", hostLabel(host), agent.model].filter(Boolean).join(" · ")}</Text>
      </HoverRow>;
    })}
  </DeskPanel>;
});

export const DeskNeedsPanel = memo(function DeskNeedsPanel({ onLayout }: { onLayout: PanelLayout }) {
  const navigation = useNavigation<Nav>();
  const items = approvals.use(st => st.items);
  const pending = useMemo(() => items.filter(actionable), [items]);
  const records = permissionRequests.state.use(st => st.records);
  const asks = useMemo(() => Object.values(records).filter(r => r.phase === "pending" || r.phase === "deciding"), [records]);
  const conversations = store.use(st => st.conversations);
  return <DeskPanel id="needs" title="Needs you" meta={`${pending.length + asks.length}`} onLayout={onLayout}>
    {pending.length + asks.length === 0 ? <Text style={s.empty}>Nothing is waiting on you.</Text> : null}
    {asks.map(ask => {
      const chat = conversations.find(c => c.id === ask.conversationId);
      return <HoverRow key={ask.requestId} label={`Permission request in ${chat?.title ?? "a chat"}`} onPress={() => { setActive(ask.conversationId); navigation.navigate("Chat"); }}>
        <View style={[s.dot, { backgroundColor: colors.warn }]} />
        <Text style={s.name} numberOfLines={1}>{`Permission · ${chat?.title ?? ask.sessionId}`}</Text>
        <Text style={s.faint}>{`${Math.max(0, Math.round((ask.deadlineAt - Date.now()) / 1000))} s left`}</Text>
      </HoverRow>;
    })}
    {pending.slice(0, 8).map(item => <HoverRow key={item.id} testID={`desk-approval-${item.id}`} label={`Review ${itemTitle(item)}`} onPress={() => navigation.navigate("Approvals")}>
      <View style={[s.dot, { backgroundColor: colors.gold }]} />
      <Text style={s.name} numberOfLines={1}>{itemTitle(item)}</Text>
      <Text style={s.pill}>{item.kind}</Text>
    </HoverRow>)}
    {pending.length > 8 ? <Text style={s.faint}>{`+${pending.length - 8} more`}</Text> : null}
    {pending.length ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Approvals")} style={s.row}><Text style={s.action}>{`Open approvals (${pending.length})`}</Text></Pressable> : null}
  </DeskPanel>;
});

export const DeskTracesPanel = memo(function DeskTracesPanel({ onLayout }: { onLayout: PanelLayout }) {
  const navigation = useNavigation<Nav>();
  return <DeskPanel id="traces" title="Traces" onLayout={onLayout}>
    <View style={styles.indent}><TraceEntryCard onOpen={() => navigation.navigate("Trace")} /></View>
  </DeskPanel>;
});

function parseHealth(raw: unknown): { release: string | null; startedAtMs: number } | null {
  if (typeof raw !== "object" || raw === null || !("startedAtMs" in raw) || typeof raw.startedAtMs !== "number") return null;
  const release = "release" in raw && typeof raw.release === "string" ? raw.release : null;
  return { release, startedAtMs: raw.startedAtMs };
}

function channelLabel(): string {
  if (Platform.OS === "web" && typeof location !== "undefined") {
    if (location.port === "8213") return "turbo :8213";
    if (location.port === "8214") return "RC3 channel :8214";
    return "web";
  }
  return TURBO ? "turbo (Metro)" : "release APK";
}

export const DeskBuildPanel = memo(function DeskBuildPanel({ onLayout }: { onLayout: PanelLayout }) {
  const open = deskPrefs.use(st => st.collapsed.build !== true);
  const health = useBridgeJson("/health", parseHealth, 60_000, open);
  const sha = RUNNING_BUILD ? shortSha(RUNNING_BUILD) : SERVED_BUILD.sha ? SERVED_BUILD.sha.slice(0, 7) : "local checkout";
  const release = health.data?.release?.slice(0, 7);
  return <DeskPanel id="build" title="Build" onLayout={onLayout}>
    <View testID="desk-build-chip" style={s.row} accessibilityLabel={`App ${sha}, ${channelLabel()}, bridge ${release ?? "release unknown"}`}>
      <Text style={s.pill}>{`app ${sha}`}</Text>
      <Text style={s.pill}>{channelLabel()}</Text>
      <Text style={s.pill}>{`bridge ${release ?? (health.error ? "unreachable" : health.data ? "unreleased" : "…")}`}</Text>
      {health.data ? <Text style={s.faint}>{`up ${timeAgo(health.data.startedAtMs)}`}</Text> : null}
    </View>
  </DeskPanel>;
});

const styles = StyleSheet.create({
  host: { paddingVertical: 2 },
  indent: { paddingLeft: space.md + 14, paddingRight: space.md },
  util: { gap: 4, paddingTop: 4 },
  strip: { flexDirection: "row", alignItems: "flex-end", height: STRIP_HEIGHT, gap: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 1, borderTopRightRadius: 1 },
});
