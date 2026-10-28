import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { HostInfo } from "../../shared/protocol";
import type { UtilizationSnapshot, UtilizationWindow } from "../../shared/host-utilization";

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const UTILIZATION_GAP_CAP = 2 * MINUTE;
export interface UtilizationSample {
  ts: number; hostId: string; cpuPct: number | null; gpuPct: number | null;
  online: boolean; state: string; duration: number;
}
/** Each measurement describes the interval ending at ts. Missing/offline time is not idle. */
export function summarizeUtilization(samples: readonly UtilizationSample[], now: number, hours: number): UtilizationWindow {
  let observed = 0, busy = 0, cpu = 0, cpuTime = 0, gpu = 0, gpuTime = 0, end = now - hours * HOUR;
  for (const s of [...samples].sort((a, b) => a.ts - b.ts)) {
    const start = Math.max(end, s.ts - Math.min(UTILIZATION_GAP_CAP, Math.max(0, s.duration)));
    const stop = Math.min(now, s.ts), duration = Math.max(0, stop - start);
    end = Math.max(end, stop);
    if (!s.online || s.state !== "observed" || (s.cpuPct === null && s.gpuPct === null)) continue;
    observed += duration;
    if (Math.max(s.cpuPct ?? 0, s.gpuPct ?? 0) >= 70) busy += duration;
    if (s.cpuPct !== null) { cpu += s.cpuPct * duration; cpuTime += duration; }
    if (s.gpuPct !== null) { gpu += s.gpuPct * duration; gpuTime += duration; }
  }
  return { hours, utilization: observed ? busy / observed * 100 : null, coverage: Math.min(1, observed / (hours * HOUR)), averageCpu: cpuTime ? cpu / cpuTime : null, averageGpu: gpuTime ? gpu / gpuTime : null };
}
export const utilizationDatabasePath = () => process.env.DASH_HOST_UTILIZATION_DB || join(homedir(), ".local/state/dash/hosts.db");
export class HostUtilizationStore {
  private db: Database;
  private lastHour = -1;
  constructor(path = utilizationDatabasePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS utilization_samples (
        ts INTEGER NOT NULL, hostId TEXT NOT NULL, cpuPct REAL, gpuPct REAL,
        online INTEGER NOT NULL, state TEXT NOT NULL, duration INTEGER NOT NULL,
        PRIMARY KEY(hostId,ts));
      CREATE INDEX IF NOT EXISTS utilization_samples_time ON utilization_samples(ts);
      CREATE TABLE IF NOT EXISTS utilization_hourly (
        hour INTEGER NOT NULL, hostId TEXT NOT NULL, busy_ms REAL NOT NULL, observed_ms REAL NOT NULL,
        total_count INTEGER NOT NULL, busy_count INTEGER NOT NULL, average_cpu REAL, max_cpu REAL,
        average_gpu REAL, max_gpu REAL, PRIMARY KEY(hostId,hour));`);
  }
  record(samples: readonly UtilizationSample[], now = Date.now()): void {
    this.db.transaction(() => {
      const insert = this.db.query("INSERT OR IGNORE INTO utilization_samples VALUES (?,?,?,?,?,?,?)");
      for (const s of samples) insert.run(s.ts, s.hostId, s.cpuPct, s.gpuPct, Number(s.online), s.state, Math.min(UTILIZATION_GAP_CAP, Math.max(0, s.duration)));
      const hour = Math.floor(now / HOUR) * HOUR;
      if (this.lastHour === hour) return;
      // Rebuild retained complete hours, including intervals crossing an hour boundary.
      const rows = this.db.query<UtilizationSample, [number]>("SELECT ts,hostId,cpuPct,gpuPct,online,state,duration FROM utilization_samples WHERE ts>=? ORDER BY ts").all(now - 14 * DAY);
      const groups = new Map<string, { hostId: string; hour: number; samples: UtilizationSample[] }>();
      for (const s of rows) {
        const first = Math.floor((s.ts - s.duration) / HOUR) * HOUR;
        const last = Math.min(hour - HOUR, Math.floor((s.ts - 1) / HOUR) * HOUR);
        for (let h = first; h <= last; h += HOUR) {
          const key = `${s.hostId}:${h}`;
          let group = groups.get(key);
          if (!group) { group = { hostId: s.hostId, hour: h, samples: [] }; groups.set(key, group); }
          group.samples.push(s);
        }
      }
      const rollup = this.db.query("INSERT OR REPLACE INTO utilization_hourly VALUES (?,?,?,?,?,?,?,?,?,?)");
      for (const g of groups.values()) {
        const summary = summarizeUtilization(g.samples, g.hour + HOUR, 1);
        const observed = g.samples.filter(s => s.online && s.state === "observed" && (s.cpuPct !== null || s.gpuPct !== null));
        const cpus = observed.flatMap(s => s.cpuPct === null ? [] : [s.cpuPct]), gpus = observed.flatMap(s => s.gpuPct === null ? [] : [s.gpuPct]);
        const ms = summary.coverage * HOUR;
        rollup.run(g.hour, g.hostId, ms * (summary.utilization ?? 0) / 100, ms, observed.length, observed.filter(s => Math.max(s.cpuPct ?? 0, s.gpuPct ?? 0) >= 70).length, summary.averageCpu, cpus.length ? Math.max(...cpus) : null, summary.averageGpu, gpus.length ? Math.max(...gpus) : null);
      }
      this.db.query("DELETE FROM utilization_samples WHERE ts<?").run(now - 14 * DAY);
      this.db.query("DELETE FROM utilization_hourly WHERE hour<?").run(now - 400 * DAY);
    })();
    this.lastHour = Math.floor(now / HOUR) * HOUR;
  }
  snapshot(hosts: readonly HostInfo[], now = Date.now()): UtilizationSnapshot {
    const query = this.db.query<UtilizationSample, [string, number]>("SELECT ts,hostId,cpuPct,gpuPct,online,state,duration FROM utilization_samples WHERE hostId=? AND ts>=? ORDER BY ts");
    return { generatedAt: now, hosts: hosts.map(h => {
      const samples = query.all(h.id, now - 7 * DAY);
      return { hostId: h.id, day: summarizeUtilization(samples, now, 24), week: summarizeUtilization(samples, now, 168) };
    }) };
  }
  close(): void { this.db.close(); }
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const percent = (v: unknown): number | null => { const n = numeric(v); return n !== null && n <= 100 ? n : null; };
interface Counters { ts: number; total: number; busy: number }
/** Reads local counters and cached fleet probes only; no phone locks or remote commands. */
export function createUtilizationCollector() {
  const previous = new Map<string, Counters>();
  const seen = new Map<string, number>();
  function cpu(hostId: string, ts: number, total: number, busy: number): { cpuPct: number | null; duration: number } {
    const old = previous.get(hostId);
    previous.set(hostId, { ts, total, busy });
    if (!old || ts <= old.ts || total <= old.total || busy < old.busy) return { cpuPct: null, duration: 0 };
    return { cpuPct: percent((busy - old.busy) / (total - old.total) * 100), duration: ts - old.ts };
  }
  async function gpu(): Promise<number | null> {
    try {
      const proc = Bun.spawn(["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"], { stdout: "pipe", stderr: "ignore" });
      const timeout = setTimeout(() => proc.kill(), 2000);
      try {
        const output = await new Response(proc.stdout).text();
        if (await proc.exited !== 0) return null;
        const values = output.trim().split("\n").filter(v => v.trim()).map(v => percent(Number(v.trim()))).filter((v): v is number => v !== null);
        return values.length ? Math.max(...values) : null;
      } finally { clearTimeout(timeout); }
    } catch { return null; }
  }
  return async (hosts: readonly HostInfo[], now = Date.now()): Promise<UtilizationSample[]> => {
    const samples: UtilizationSample[] = [];
    for (const host of hosts) {
      const missing = (state: string): UtilizationSample => ({ ts: now, hostId: host.id, cpuPct: null, gpuPct: null, online: host.online, state, duration: MINUTE });
      if (!host.online) { previous.delete(host.id); samples.push(missing("offline")); continue; }
      if (host.self) {
        try {
          const line = (await readFile("/proc/stat", "utf8")).split("\n")[0] ?? "";
          const values = line.trim().split(/\s+/).slice(1, 9).map(Number);
          if (values.length !== 8 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("CPU counters unavailable");
          const total = values.reduce((sum, n) => sum + n, 0), idle = (values[3] ?? 0) + (values[4] ?? 0);
          const measurement = cpu(host.id, now, total, total - idle);
          const gpuPct = await gpu();
          samples.push({ ...missing(measurement.cpuPct === null ? "warming-up" : "observed"), ...measurement, gpuPct });
        } catch { previous.delete(host.id); samples.push(missing("counters-unavailable")); }
        continue;
      }
      // Cached probes must carry true all-core CPU% or cumulative counters. Android load1 is not CPU%.
      const name = host.hostname || host.name;
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) { samples.push(missing("probe-unavailable")); continue; }
      try {
        const raw: unknown = JSON.parse(await readFile(join(process.env.DASH_FLEET_HEALTH_DIR || join(homedir(), ".local/state/fleet/health"), `${name}.json`), "utf8"));
        if (!record(raw) || !record(raw.probe) || numeric(raw.ts) === null) throw new Error("Invalid probe");
        const ts = Number(raw.ts) * 1000, p = raw.probe;
        if (ts > now || now - ts > 10 * MINUTE || p.error) throw new Error("Stale or failed probe");
        if (ts <= (seen.get(host.id) ?? 0)) continue;
        const oldTs = seen.get(host.id);
        seen.set(host.id, ts);
        const total = numeric(p.cpu_total_jiffies), busy = numeric(p.cpu_busy_jiffies);
        const measurement = total !== null && busy !== null && busy <= total ? cpu(host.id, ts, total, busy) : { cpuPct: percent(p.cpu_pct), duration: oldTs ? ts - oldTs : MINUTE };
        const gpuPct = percent(p.gpu_pct);
        samples.push({ ...missing(measurement.cpuPct === null && gpuPct === null ? "compute-unavailable" : "observed"), ts, ...measurement, gpuPct });
      } catch { previous.delete(host.id); samples.push(missing("probe-unavailable")); }
    }
    return samples;
  };
}
export function startHostUtilization(options: { roster(): Promise<HostInfo[]>; store: HostUtilizationStore }) {
  const collect = createUtilizationCollector();
  let pending = false, stopped = false;
  async function tick() {
    if (pending || stopped) return;
    pending = true;
    try { const samples = await collect(await options.roster()); if (!stopped) options.store.record(samples); }
    catch (error) { console.warn("Host utilization sample unavailable", error instanceof Error ? error.message : "unknown error"); }
    finally { pending = false; }
  }
  void tick();
  const timer = setInterval(() => void tick(), MINUTE);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); options.store.close(); };
}
export function createHostUtilizationHttpHandler(options: { authorize(request: Request): Promise<boolean>; roster(): Promise<HostInfo[]>; store: HostUtilizationStore }) {
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/hosts/utilization") return null;
    if (!await options.authorize(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "GET" } });
    return Response.json(options.store.snapshot(await options.roster()), { headers: { "Cache-Control": "no-store" } });
  };
}
