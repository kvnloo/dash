import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HermesProfileCache, readHermesProfiles } from "./hermes-profiles";
import type { HermesProfileInfo } from "./roster";

const good: HermesProfileInfo[] = [{ id: "default", gateway: "running" }];

describe("Hermes profile refresh", () => {
  test("a slow refresh serves the last good roster, single-flight, even after the old kill deadline", async () => {
    let calls = 0;
    let finish: ((profiles: HermesProfileInfo[]) => void) | undefined;
    const cache = new HermesProfileCache(() => {
      calls++;
      return calls === 1 ? Promise.resolve(good) : calls === 2
        ? new Promise(resolve => { finish = resolve; })
        : Promise.resolve([{ id: "clean", gateway: "running" }]);
    });
    expect(cache.read()).toEqual([]);
    await cache.refresh();
    const pending = cache.refresh();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      expect(cache.read()).toEqual(good);
      expect(cache.refresh()).toBe(pending);
    }
    expect(performance.now() - start).toBeLessThan(100);
    await Bun.sleep(2600);
    expect(cache.read()).toEqual(good);
    expect(calls).toBe(2);
    const updated: HermesProfileInfo[] = [{ id: "clean", gateway: "running" }];
    finish?.(updated);
    await pending;
    // Read serves the completed snapshot while the next refresh starts.
    expect(cache.read()).toEqual(updated);
    finish?.(updated);
    await cache.refresh();
  });

  test("failed refresh preserves good cache and allows retry; successful empty clears it", async () => {
    let calls = 0;
    const cache = new HermesProfileCache(async () => {
      calls++;
      if (calls === 1) return good;
      if (calls === 2) throw new Error("temporarily unreadable");
      return [];
    });
    await cache.refresh();
    await cache.refresh();
    expect(cache.read()).toEqual(good);
    await cache.refresh();
    expect(cache.read()).toEqual([]);
    await cache.refresh();
  });

  test("native projection reads profiles without credentials or spawning children", async () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? join(homedir(), ".cache"), "dash-hermes-profiles-"));
    const spawn = spyOn(Bun, "spawn");
    const spawnSync = spyOn(Bun, "spawnSync");
    try {
      for (const name of ["clean", "offline"]) mkdirSync(join(root, "profiles", name), { recursive: true });
      writeFileSync(join(root, "gateway_state.json"), JSON.stringify({ kind: "hermes-gateway", gateway_state: "running", pid: 123, hermes_home: root, served_profiles: ["clean"] }));
      const profiles = await readHermesProfiles(root, pid => pid === 123);
      expect(profiles).toEqual([
        { id: "default", gateway: "running" },
        { id: "clean", gateway: "running" },
        { id: "offline", gateway: "stopped" },
      ]);
      expect((await readHermesProfiles(root, () => false)).every(p => p.gateway === "stopped")).toBe(true);
      // No CLI fallback means no child process tree to orphan or kill.
      const source = readFileSync(new URL("./hermes-profiles.ts", import.meta.url), "utf8");
      expect(source).not.toMatch(/Bun\.spawn|node:child_process|["']\.env["']/);
      expect(spawn).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    } finally {
      spawn.mockRestore();
      spawnSync.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("connect roster uses non-awaiting native cache, never the secrets-loading Hermes CLI", () => {
  const source = readFileSync(new URL("./roster.ts", import.meta.url), "utf8");
  expect(source).not.toContain('["hermes", "gateway", "list"]');
  expect(source).toContain("hermesProfileCache.read()");
  expect(source).not.toMatch(/await\s+hermesProfileCache/);
});
