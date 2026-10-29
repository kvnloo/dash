import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HostStats, HostUtilization, HostUtilizationBucket } from "../../shared/protocol";

/**
 * The bridge's own host utilization over a rolling window, from the same counters `/hosts/stats`
 * reads. A sample is busy when CPU or GPU is at or above the threshold ("maxed out"). Buckets are
 * kept on disk so a bridge restart does not erase the day; nothing here touches other hosts.
 */
export interface UtilizationOptions {
  hostId(): string;
  collect(): Promise<HostStats>;
  file: string;
  sampleMs: number;
  bucketMs: number;
  windowMs: number;
  busyThresholdPct: number;
  now?(): number;
}

interface Accumulator {
  at: number;
  samples: number;
  cpuSum: number; cpuN: number; cpuMax: number;
  gpuSum: number; gpuN: number;
  memSum: number; memN: number;
  busy: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function toBucket(a: Accumulator): HostUtilizationBucket {
  return {
    at: a.at, samples: a.samples, busy: a.busy,
    ...(a.cpuN ? { cpuAvg: a.cpuSum / a.cpuN, cpuMax: a.cpuMax } : {}),
    ...(a.gpuN ? { gpuAvg: a.gpuSum / a.gpuN } : {}),
    ...(a.memN ? { memAvg: a.memSum / a.memN } : {}),
  };
}

function fromStored(value: unknown): Accumulator | null {
  if (typeof value !== "object" || value === null) return null;
  const v: Record<string, unknown> = { ...value };
  const keys = ["at", "samples", "cpuSum", "cpuN", "cpuMax", "gpuSum", "gpuN", "memSum", "memN", "busy"] as const;
  if (!keys.every(key => finite(v[key]))) return null;
  const read = (key: typeof keys[number]): number => { const n = v[key]; return finite(n) ? n : 0; };
  return { at: read("at"), samples: read("samples"), cpuSum: read("cpuSum"), cpuN: read("cpuN"), cpuMax: read("cpuMax"), gpuSum: read("gpuSum"), gpuN: read("gpuN"), memSum: read("memSum"), memN: read("memN"), busy: read("busy") };
}

export function createUtilizationRecorder(options: UtilizationOptions) {
  const now = options.now ?? Date.now;
  const buckets: Accumulator[] = [];
  let startedAt = now();
  let loaded = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sampling = false;
  let lastSaved = 0;

  const prune = (at: number) => {
    while (buckets.length && (buckets[0]?.at ?? at) + options.bucketMs <= at - options.windowMs) buckets.shift();
  };

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw: unknown = JSON.parse(await readFile(options.file, "utf8"));
      if (typeof raw !== "object" || raw === null || !("hostId" in raw) || !("buckets" in raw) || raw.hostId !== options.hostId() || !Array.isArray(raw.buckets)) return;
      for (const item of raw.buckets) { const bucket = fromStored(item); if (bucket && bucket.at % options.bucketMs === 0) buckets.push(bucket); }
      buckets.sort((a, b) => a.at - b.at);
      prune(now());
      if (buckets[0]) startedAt = Math.min(startedAt, buckets[0].at);
    } catch { /* No history yet, or unreadable: start fresh. */ }
  }

  async function save() {
    try {
      await mkdir(dirname(options.file), { recursive: true });
      const temp = `${options.file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ hostId: options.hostId(), buckets }), { mode: 0o600 });
      await rename(temp, options.file);
    } catch { /* History stays in memory. */ }
  }

  function add(stats: HostStats) {
    const at = stats.sampledAt - (stats.sampledAt % options.bucketMs);
    let bucket = buckets.at(-1);
    if (!bucket || bucket.at !== at) {
      bucket = { at, samples: 0, cpuSum: 0, cpuN: 0, cpuMax: 0, gpuSum: 0, gpuN: 0, memSum: 0, memN: 0, busy: 0 };
      buckets.push(bucket);
      prune(stats.sampledAt);
    }
    bucket.samples += 1;
    const gpu = stats.gpus?.map(g => g.usagePct).filter(finite);
    const gpuPct = gpu?.length ? Math.max(...gpu) : undefined;
    if (stats.cpuPct !== undefined) { bucket.cpuSum += stats.cpuPct; bucket.cpuN += 1; bucket.cpuMax = Math.max(bucket.cpuMax, stats.cpuPct); }
    if (gpuPct !== undefined) { bucket.gpuSum += gpuPct; bucket.gpuN += 1; }
    if (stats.memory && stats.memory.totalBytes > 0) { bucket.memSum += 100 * stats.memory.usedBytes / stats.memory.totalBytes; bucket.memN += 1; }
    if ((stats.cpuPct ?? 0) >= options.busyThresholdPct || (gpuPct ?? 0) >= options.busyThresholdPct) bucket.busy += 1;
  }

  async function sample() {
    if (sampling) return;
    sampling = true;
    try {
      await load();
      add(await options.collect());
      if (now() - lastSaved >= Math.min(options.bucketMs, 60_000)) { lastSaved = now(); await save(); }
    } catch { /* A failed reading is a gap, not a zero. */ } finally { sampling = false; }
  }

  return {
    start() {
      if (timer) return;
      void sample();
      timer = setInterval(() => void sample(), options.sampleMs);
      // Never keep the process alive for history alone.
      if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
    async snapshot(): Promise<HostUtilization> {
      await load();
      const at = now();
      prune(at);
      const first = buckets[0];
      return {
        hostId: options.hostId(), sampledAt: at, since: Math.max(first ? Math.min(first.at, startedAt) : startedAt, at - options.windowMs),
        sampleMs: options.sampleMs, bucketMs: options.bucketMs, windowMs: options.windowMs, busyThresholdPct: options.busyThresholdPct,
        buckets: buckets.map(toBucket),
      };
    },
  };
}
