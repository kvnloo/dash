import { StyleSheet, Text, View } from "react-native";
import { store } from "../store/app";
import { useHostStats } from "../lib/useHostStats";
import { colors, type } from "../theme";

const gib = (bytes: number) => (bytes / 1073741824).toFixed(1);
const pct = (value: number | undefined) => value === undefined ? "sampling…" : `${Math.round(value)}%`;

/** Local stats only: a remote chat must never inherit the connected bridge's readings. */
export function HostStatsRow({ hostId }: { hostId: string | undefined }) {
  const settings = store.use(s => s.settings);
  const local = store.use(s => s.connection.hosts.some(h => h.id === hostId && h.self && h.online));
  const { snapshot: stats, error } = useHostStats(local ? settings : null, hostId);
  return <View testID="host-stats-row" style={styles.row}>
    {!local || error ? <Text style={styles.text}>Stats unavailable for this host</Text> : !stats ? <Text style={styles.text}>Loading host stats…</Text> : <>
      <Text style={styles.text}>CPU {pct(stats.cpuPct)} · {stats.cpuCount} cores</Text>
      <Text style={styles.text}>{stats.memory ? `RAM ${gib(stats.memory.usedBytes)}/${gib(stats.memory.totalBytes)} GiB` : "RAM unavailable"}</Text>
      <Text style={styles.text}>{stats.disk ? `Disk ${stats.disk.path} ${gib(stats.disk.usedBytes)}/${gib(stats.disk.totalBytes)} GiB` : "Disk unavailable"}</Text>
      {stats.load ? <Text style={styles.text}>Load {stats.load.one.toFixed(2)} / {stats.load.five.toFixed(2)} / {stats.load.fifteen.toFixed(2)}</Text> : null}
      {stats.gpus?.map((gpu, i) => <Text key={i} style={styles.text}>GPU {gpu.name} {gpu.usagePct === undefined ? "usage unavailable" : pct(gpu.usagePct)}{gpu.usedBytes !== undefined && gpu.totalBytes !== undefined ? ` · VRAM ${gib(gpu.usedBytes)}/${gib(gpu.totalBytes)} GiB` : ""}{gpu.temperatureC !== undefined ? ` · ${gpu.temperatureC.toFixed(0)}°C` : ""}</Text>)}
      {stats.temperatureC !== undefined ? <Text style={styles.text}>Temp {stats.temperatureC.toFixed(0)}°C</Text> : null}
      {stats.battery ? <Text style={styles.text}>Battery {Math.round(stats.battery.percent)}% · {stats.battery.status}{stats.battery.temperatureC !== undefined ? ` · ${stats.battery.temperatureC.toFixed(0)}°C` : ""}</Text> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2, paddingVertical: 4 },
  text: { ...type.mono, fontSize: 11, lineHeight: 15, color: colors.textMuted, flexShrink: 1 },
});
