import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTraceRoute } from "./trace-route";
import { collectTrace } from "./trace-collect";
import { parseTraceSnapshot } from "../../app/src/trace/model";

test("live route refuses unauthenticated reads, ignores other paths and serves new source events after the cache window", async () => {
  const root = mkdtempSync(join(tmpdir(), "trace-route-"));
  const runs = join(root, "runs"), fleet = join(root, "fleet");
  mkdirSync(runs); mkdirSync(fleet);
  writeFileSync(join(fleet, "20261022-120000-aabb-mbp.log"), "# exit 0\n");
  let now = Date.now();
  const route = createTraceRoute({ authorize: async r => r.headers.get("Authorization") === "Bearer ok", collect: () => collectTrace({ runs, fleet, profiles: [], roots: [runs], now }), roots: [runs] });
  try {
    expect(await route(new Request("http://bridge/chat"))).toBeNull();
    expect((await route(new Request("http://bridge/trace/snapshot")))?.status).toBe(401);
    const first = parseTraceSnapshot(await (await route(new Request("http://bridge/trace/snapshot", { headers: { Authorization: "Bearer ok" } })))?.json());
    expect(first.rows.map(r => r.key)).toEqual(["fleet:20261022-120000-aabb-mbp.log"]);
    writeFileSync(join(fleet, "20261022-120500-ccdd-mbp.log"), "# exit 0\n");
    now += 1000;
    await Bun.sleep(3100);
    const second = parseTraceSnapshot(await (await route(new Request("http://bridge/trace/snapshot", { headers: { Authorization: "Bearer ok" } })))?.json());
    expect(second.rows.map(r => r.key).sort()).toEqual(["fleet:20261022-120000-aabb-mbp.log", "fleet:20261022-120500-ccdd-mbp.log"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 10000);
