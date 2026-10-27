import { expect, test } from "bun:test";
import { evaluateHumanPosture } from "../../../shared/human-posture";
import { policy, route } from "../../../shared/interaction-policy";
import { createNoticePostureReader, nativeNoticeAllowed, notificationChannels } from "./notice-posture";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const quietNow = Date.parse("2026-10-28T02:30:00Z");
const peakNow = Date.parse("2026-10-27T13:00:00Z");
const decision = (now: number) => policy(evaluateHumanPosture({}, new Date(now).toISOString()), new Date(now).toISOString());
test("C2 C10 quiet phase never raises OS notice, including approvals; daytime uses route", () => {
  for (const phase of ["WIND_DOWN", "PRE_SLEEP", "SLEEP", "DISENGAGED"]) {
    const d = decision(quietNow);
    if (phase === "WIND_DOWN" || phase === "PRE_SLEEP" || phase === "SLEEP" || phase === "DISENGAGED") d.phase = phase;
    for (const cls of ["report", "decision", "digest", "critical"]) expect(nativeNoticeAllowed(d, route(d, { cls, producer: "dash-notify" }, new Date(quietNow).toISOString()))).toBe(false);
  }
  const d = decision(peakNow);
  expect(nativeNoticeAllowed(d, route(d, { cls: "decision" }, new Date(peakNow).toISOString()))).toBe(true);
  d.allowDecisions = "none";
  expect(nativeNoticeAllowed(d, route(d, { cls: "decision" }, new Date(peakNow).toISOString()))).toBe(false);
});
test("posture reader authenticates, caches 5 minutes and isolates paired credentials", async () => {
  let calls = 0; const headers: string[] = []; let now = peakNow;
  const d = decision(peakNow);
  const reader = createNoticePostureReader({ now: () => now, token: async s => s.token,
    fetch: async (_url, init) => { calls++; headers.push(new Headers(init?.headers).get("authorization") ?? ""); return Response.json({ ...d, schema: "dash.posture_view/v1", phase: "DISENGAGED", channel: "dash-quiet", allowDecisions: "none" }); } });
  const settings = { address: "", token: "synthetic-token" };
  expect((await reader(settings)).phase).toBe("DISENGAGED");
  expect((await reader(settings)).allowDecisions).toBe("none"); expect(calls).toBe(1);
  now += 300_000; await reader(settings); expect(calls).toBe(2);
  await reader({ ...settings, token: "synthetic-other" }); expect(calls).toBe(3);
  expect(headers).toEqual(["Bearer synthetic-token", "Bearer synthetic-token", "Bearer synthetic-other"]);
});
test("posture failure, invalid schema, invalid fields, and unpaired all use clock-only", async () => {
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => new Response("denied", { status: 401 }), async () => Response.json({}), async () => Response.json({ schema: "dash.posture_view/v1", phase: "arbitrary" })]) {
    const reader = createNoticePostureReader({ now: () => quietNow, token: async () => "synthetic", fetch: fetcher });
    expect(await reader({ address: "", token: "" })).toEqual(decision(quietNow));
    expect(await reader(null)).toEqual(decision(quietNow));
  }
});
test("C14 immutable channels migrate updates to new LOW id; only focus can sound", () => {
  const channels = notificationChannels({ LOW: 2, DEFAULT: 3 }, 0);
  expect(channels["dash-quiet"]).toMatchObject({ id: "dash-quiet", importance: 2, sound: null, enableVibrate: false });
  expect(channels["dash-updates"]).toMatchObject({ id: "dash-updates-low-v1", importance: 2, sound: null, enableVibrate: false });
  expect(channels["dash-focus"]).toMatchObject({ id: "dash-focus", sound: "default" });
  for (const [name, config] of Object.entries(channels)) if (name !== "dash-focus") expect(config.sound).toBeNull();
});
test("C1 exactly one scheduling call site, within postNativeNotice after route", () => {
  const root = join(import.meta.dir, "..");
  function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") ? [join(dir, e.name)] : []); }
  const sites = files(root).flatMap(file => [...readFileSync(file, "utf8").matchAll(/\.scheduleNotificationAsync\s*\(/g)].map(m => ({ file, index: m.index })));
  expect(sites).toHaveLength(1);
  const site = sites[0]; if (!site) throw new Error("missing notification gate");
  expect(site.file).toBe(join(root, "lib/native-notifications.native.ts"));
  const source = readFileSync(site.file, "utf8");
  expect(source.indexOf("function postNativeNotice")).toBeLessThan(site.index);
  const routed = source.indexOf("route(", source.indexOf("function postNativeNotice"));
  expect(routed).toBeGreaterThan(source.indexOf("function postNativeNotice"));
  expect(routed).toBeLessThan(site.index);
  expect(source).toContain("nativeNoticeAllowed(decision, routed)");
  expect(readFileSync(join(root, "components/NativeEvents.tsx"), "utf8")).toContain('class: "decision"');
});
