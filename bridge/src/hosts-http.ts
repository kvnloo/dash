import type { HostStats } from "../../shared/protocol";
import { createHostStatsCollector } from "./host-stats";

export function createHostsHttpHandler(options: { authorize(request: Request): Promise<boolean>; hostId(): string }) {
  const collect = createHostStatsCollector(options.hostId);
  let cache: HostStats | undefined;
  let pending: Promise<HostStats> | undefined;
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/hosts/stats") return null;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    if (!await options.authorize(request)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    try {
      if (!cache || Date.now() - cache.sampledAt >= 5000) {
        pending ??= collect().finally(() => { pending = undefined; });
        cache = await pending;
      }
      return json(cache);
    } catch { return json({ error: "Host stats unavailable" }, 503); }
  };
}
