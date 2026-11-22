import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZ0LiveLanes, readZ0LiveState, z0liveLanesHttp } from "./z0live-state";

const dir = mkdtempSync(join(tmpdir(), "z0live-lanes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const T = 1_800_000_000;
const write = (name: string, rows: object[], mtime: number) => {
  const path = join(dir, name);
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  utimesSync(path, mtime, mtime);
};

describe("bridge z0live lanes", () => {
  test("reads lanes from the newest session only, alongside the unchanged call state", () => {
    write("old.jsonl", [{ type: "lane_step", ts: T, data: { lane: "old", step: "Old work" } }], T - 100);
    write("live.jsonl", [
      { type: "app_state", ts: T, data: { source: "connected" } },
      { type: "lane_attached", ts: T, data: { lane: "council", name: "Council", model: "3 models" } },
      { type: "lane_step", ts: T + 1, data: { lane: "council", step: "Voting" } },
    ], T);
    const lanes = readZ0LiveLanes(dir, T + 2);
    expect(lanes).toEqual({ sessionId: "live", updated: T + 1, now: T + 2, lanes: [{ id: "council", name: "Council", model: "3 models", status: "working", step: "Voting", since: T + 1 }] });
    expect(readZ0LiveState(dir, T + 2)).toMatchObject({ live: true, sessionId: "live" });
  });

  test("a missing directory is no lanes, not an error", () => {
    expect(readZ0LiveLanes(join(dir, "missing"), T)).toEqual({ sessionId: "", lanes: [], updated: 0, now: T });
  });

  test("GET /z0live/lanes needs auth and GET, and never caches", async () => {
    const read = () => ({ sessionId: "s", lanes: [], updated: T, now: T });
    expect(z0liveLanesHttp(new Request("http://h/z0live/state"), true, read)).toBeUndefined();
    expect(z0liveLanesHttp(new Request("http://h/z0live/lanes"), false, read)?.status).toBe(401);
    expect(z0liveLanesHttp(new Request("http://h/z0live/lanes", { method: "POST" }), true, read)?.status).toBe(405);
    const ok = z0liveLanesHttp(new Request("http://h/z0live/lanes"), true, read);
    expect(ok?.status).toBe(200);
    expect(ok?.headers.get("cache-control")).toBe("no-store");
    expect(await ok?.json()).toEqual(read());
  });
});
