import { homedir } from "node:os";
import { join } from "node:path";
import type { HostStats } from "../../shared/protocol";
import { createHostStatsCollector } from "./host-stats";
import { createUtilizationRecorder } from "./host-utilization";

function envMs(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export function createHostsHttpHandler(options: { authorize(request: Request): Promise<boolean>; hostId(): string }) {
  const collect = createHostStatsCollector(options.hostId);
  let cache: HostStats | undefined;
  let pending: Promise<HostStats> | undefined;
  // History has its own collector: its CPU deltas must not be reset by an app's /hosts/stats poll.
  const utilization = createUtilizationRecorder({
    hostId: options.hostId,
    collect: createHostStatsCollector(options.hostId),
    file: process.env.DASH_UTILIZATION_FILE ?? join(process.env.DASH_CONFIG_DIR ?? join(homedir(), ".dash"), "host-utilization.json"),
    sampleMs: envMs("DASH_UTILIZATION_SAMPLE_MS", 20_000, 250),
    bucketMs: envMs("DASH_UTILIZATION_BUCKET_MS", 5 * 60_000, 1000),
    windowMs: envMs("DASH_UTILIZATION_WINDOW_MS", 24 * 60 * 60_000, 60_000),
    busyThresholdPct: 80,
  });
  if (process.env.DASH_UTILIZATION !== "0") utilization.start();
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (path !== "/hosts/stats" && path !== "/hosts/utilization") return null;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    if (!await options.authorize(request)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (path === "/hosts/utilization") {
      try { return json(await utilization.snapshot()); } catch { return json({ error: "Host utilization unavailable" }, 503); }
    }
    try {
      if (!cache || Date.now() - cache.sampledAt >= 5000) {
        pending ??= collect().finally(() => { pending = undefined; });
        cache = await pending;
      }
      return json(cache);
    } catch { return json({ error: "Host stats unavailable" }, 503); }
  };
}
