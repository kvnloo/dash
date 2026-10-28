import { readFile, readdir, statfs } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import type { HostStats } from "../../shared/protocol";
import { timedArgv } from "./roster";

async function text(path: string): Promise<string> { return readFile(path, "utf8").then(s => s.trim(), () => ""); }
async function entries(path: string): Promise<string[]> { return readdir(path).catch(() => []); }
function number(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
const percent = (n: number) => Math.min(100, Math.max(0, n));

async function gpuStats(): Promise<HostStats["gpus"]> {
  if (Bun.which("nvidia-smi")) {
    try {
      const child = Bun.spawn(timedArgv(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], 2), { stdout: "pipe", stderr: "ignore" });
      const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      if (code === 0) return output.trim().split("\n").filter(Boolean).map(line => {
        const [name, busy, used, total, temp] = line.split(",").map(s => s.trim());
        const usagePct = number(busy), usedMiB = number(used), totalMiB = number(total), temperatureC = number(temp);
        return { name: name || "NVIDIA GPU", ...(usagePct !== undefined ? { usagePct: percent(usagePct) } : {}),
          ...(usedMiB !== undefined ? { usedBytes: usedMiB * 1048576 } : {}), ...(totalMiB !== undefined ? { totalBytes: totalMiB * 1048576 } : {}),
          ...(temperatureC !== undefined ? { temperatureC } : {}) };
      });
    } catch { /* Optional driver/tool; try DRM below. */ }
  }
  const gpus: NonNullable<HostStats["gpus"]> = [];
  for (const card of (await entries("/sys/class/drm")).filter(n => /^card\d+$/.test(n))) {
    const device = `/sys/class/drm/${card}/device`;
    const usagePct = number(await text(join(device, "gpu_busy_percent")));
    if (usagePct === undefined) continue;
    const usedBytes = number(await text(join(device, "mem_info_vram_used")));
    const totalBytes = number(await text(join(device, "mem_info_vram_total")));
    gpus.push({ name: card, usagePct: percent(usagePct), ...(usedBytes !== undefined ? { usedBytes } : {}), ...(totalBytes !== undefined ? { totalBytes } : {}) });
  }
  return gpus.length ? gpus : undefined;
}

async function powerStats(): Promise<HostStats["battery"]> {
  for (const supply of await entries("/sys/class/power_supply")) {
    const path = `/sys/class/power_supply/${supply}`;
    if (await text(join(path, "type")) !== "Battery") continue;
    const capacity = number(await text(join(path, "capacity")));
    if (capacity === undefined) continue;
    const temp = number(await text(join(path, "temp")));
    return { percent: percent(capacity), status: await text(join(path, "status")) || "Unknown", ...(temp !== undefined ? { temperatureC: temp / 10 } : {}) };
  }
  return undefined;
}

async function temperature(): Promise<number | undefined> {
  const paths: string[] = [];
  for (const zone of await entries("/sys/class/thermal")) if (/^thermal_zone\d+$/.test(zone)) paths.push(`/sys/class/thermal/${zone}/temp`);
  for (const hw of await entries("/sys/class/hwmon")) {
    for (const file of await entries(`/sys/class/hwmon/${hw}`)) if (/^temp\d+_input$/.test(file)) paths.push(`/sys/class/hwmon/${hw}/${file}`);
  }
  const values = (await Promise.all(paths.map(text))).map(number).filter((n): n is number => n !== undefined && n < 200000);
  return values.length ? Math.max(...values) / 1000 : undefined;
}

/** One collector per bridge: counters only, no history, services or remote host access. */
export function createHostStatsCollector(hostId: () => string) {
  let previous: { total: number; idle: number; at: number } | undefined;
  return async (): Promise<HostStats> => {
    const [stat, mem, load, disk, gpus, battery, temperatureC] = await Promise.all([
      text("/proc/stat"), text("/proc/meminfo"), text("/proc/loadavg"), statfs("/").catch(() => undefined), gpuStats(), powerStats(), temperature(),
    ]);
    const stats: HostStats = { hostId: hostId(), sampledAt: Date.now(), cpuCount: stat.match(/^cpu\d+\s/gm)?.length || Math.max(1, cpus().length) };
    // Linux guest/guest_nice counters are already included in user/nice (first eight fields).
    const counters = stat.split("\n")[0]?.trim().split(/\s+/).slice(1, 9).map(Number);
    if (stat.startsWith("cpu ") && counters?.length === 8 && counters.every(Number.isFinite)) {
      const current = { total: counters.reduce((a, b) => a + b, 0), idle: (counters[3] ?? 0) + (counters[4] ?? 0), at: stats.sampledAt };
      if (previous && current.at - previous.at <= 30000 && current.total > previous.total && current.idle >= previous.idle) stats.cpuPct = percent(100 * (1 - (current.idle - previous.idle) / (current.total - previous.total)));
      previous = current;
    }
    const fields = new Map(mem.split("\n").map(line => { const [key, value] = line.split(/:\s*/); return [key, number(value?.split(/\s+/)[0])]; }));
    const total = fields.get("MemTotal"), available = fields.get("MemAvailable");
    if (total && available !== undefined) stats.memory = { totalBytes: total * 1024, usedBytes: Math.max(0, total - available) * 1024 };
    const [one, five, fifteen] = load.split(/\s+/).slice(0, 3).map(number);
    if (one !== undefined && five !== undefined && fifteen !== undefined) stats.load = { one, five, fifteen };
    if (disk && disk.blocks > 0) stats.disk = { path: "/", totalBytes: disk.blocks * disk.bsize, usedBytes: (disk.blocks - disk.bfree) * disk.bsize };
    if (gpus) stats.gpus = gpus;
    if (battery) stats.battery = battery;
    if (temperatureC !== undefined) stats.temperatureC = temperatureC;
    return stats;
  };
}
