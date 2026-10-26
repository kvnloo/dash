import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostureHttpHandler } from "./posture-http";
import { evaluateHumanPosture, parseTs } from "../../shared/human-posture";

// SYNTHETIC times only (law C8).
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const NOW = "2026-10-28T02:30:00Z"; // after the SYNTHETIC default freeze: WIND_DOWN by the clock
function setup(body?: unknown, now = NOW, config?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "dash-posture-")); dirs.push(dir);
  const file = join(dir, "posture.json"), configFile = join(dir, "config.json");
  if (body !== undefined) writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  if (config !== undefined) writeFileSync(configFile, JSON.stringify(config));
  return createPostureHttpHandler({ token: "test-only", file, configFile, now: () => parseTs(now) });
}
const req = (method = "GET", token = "test-only", path = "/posture") => new Request(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
const view = async (h: ReturnType<typeof createPostureHttpHandler>) => {
  const r = await h(req());
  expect(r?.status).toBe(200);
  expect(r?.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await r?.json();
  return body;
};

test("auth, method and path", async () => {
  const h = setup();
  expect((await h(req("GET", "wrong")))?.status).toBe(401);
  expect((await h(req("POST")))?.status).toBe(405);
  expect(await h(req("GET", "test-only", "/elsewhere"))).toBeNull();
});

test("no posture.json: clock-only, quiet after freeze", async () => {
  expect(await view(setup())).toMatchObject({ source: "clock", phase: "WIND_DOWN", allowDecisions: "none", channel: "dash-quiet", quality: "default" });
});

test("fresh posture.json: the service state, policy recomputed now", async () => {
  const state = { ...evaluateHumanPosture({ doneAt: "2026-10-28T02:00:00Z" }, NOW), quality: "proxy" };
  expect(await view(setup({ generatedAt: "2026-10-28T02:29:00Z", state }))).toMatchObject({ source: "circadiand", phase: "DISENGAGED", quality: "proxy" });
});

test("stale or malformed posture.json falls back to the clock", async () => {
  const state = evaluateHumanPosture({}, NOW);
  expect(await view(setup({ generatedAt: "2026-10-28T02:00:00Z", state }))).toMatchObject({ source: "clock" });
  expect(await view(setup("{not json"))).toMatchObject({ source: "clock" });
  expect(await view(setup({ generatedAt: NOW, state: { schema: "x" } }))).toMatchObject({ source: "clock" });
});

test("clock fallback uses the private host anchors; bad anchors fall back to defaults", async () => {
  // SYNTHETIC: a later night mode keeps 22:30 local in SECOND
  expect(await view(setup(undefined, NOW, { tz: "America/New_York", nightModeAt: "23:00", bedTarget: "02:00" }))).toMatchObject({ source: "clock", phase: "SECOND" });
  expect(await view(setup(undefined, NOW, { tz: "Not/AZone" }))).toMatchObject({ source: "clock", phase: "WIND_DOWN" });
});

test("R4: no times of day or anchors cross the bridge", async () => {
  const body = await view(setup());
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(text).not.toMatch(/anchors|wakeAt|bedTarget|freezeAt|arithmetic|lastActivity/);
});
