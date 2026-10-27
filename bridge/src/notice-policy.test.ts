import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_POSTURE_CONFIG, evaluateHumanPosture, parseTs } from "../../shared/human-posture";
import type { NoticeMessage } from "../../shared/protocol";
import { policy } from "../../shared/interaction-policy";
import { NoticeService, createNoticeHttpHandler, startNoticeServer } from "./notices";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
// SYNTHETIC timestamps, using only the default anchors.
function setup(iso = "2026-10-28T02:30:00Z", enforcingNow = true, missing = false, done = false) {
  const root = mkdtempSync(join(tmpdir(), "notice-policy-")); roots.push(root);
  const file = join(root, "posture.json"), configFile = join(root, "config.json");
  let now = parseTs(iso);
  const state = evaluateHumanPosture(done ? { doneAt: iso } : {}, iso);
  if (!missing) writeFileSync(file, JSON.stringify({ generatedAt: iso, state, enforcement: { enforcingNow } }));
  writeFileSync(configFile, JSON.stringify(DEFAULT_POSTURE_CONFIG));
  const notices = new NoticeService(root);
  const log: unknown[] = [];
  const handle = createNoticeHttpHandler({ token: "synthetic-token", notices, file, configFile, now: () => now, log: entry => log.push(entry) });
  // Resolve the local request origin from the URL standard, not a deployment address.
  const url = new URL("http://[::1]/notice");
  const send = (cls = "report", extra = {}) => handle(new Request(url.toString(), { method: "POST", headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" }, body: JSON.stringify({ title: "Synthetic update", body: "Ready", class: cls, ...extra }) }), url.hostname.slice(1, -1));
  return { root, notices, send, log, setNow: (value: string) => { now = parseTs(value); } };
}
test("C2 decision in quiet enforcement is durable, private and not broadcast", async () => {
  const s = setup(); const seen: unknown[] = []; s.notices.subscribe(n => seen.push(n));
  const response = await s.send("decision");
  expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ held: true });
  expect(seen).toHaveLength(0); expect(s.notices.list()).toHaveLength(0);
  expect(statSync(join(s.root, "notices-deferred.json")).mode & 0o777).toBe(0o600);
  expect(new NoticeService(s.root).deferred().items).toHaveLength(1);
});
test("C3 bridge counts deliveries against the block cap", async () => {
  const s = setup("2026-10-27T13:00:00Z");
  for (let i = 0; i < 3; i++) expect((await s.send("decision")).status).toBe(201);
  expect((await s.send("decision")).status).toBe(202); expect(s.notices.list()).toHaveLength(3);
});
test("C5 critical from dash-notify becomes report; C10 done holds reports", async () => {
  const s = setup(); expect((await s.send("critical")).status).toBe(202);
  expect(s.notices.deferred().items[0]?.input.class).toBe("report");
  const done = setup("2026-10-27T13:00:00Z", true, false, true);
  expect((await done.send()).status).toBe(202);
});
test("clock and disabled enforcement only log shadow actions", async () => {
  for (const s of [setup(undefined, false), setup(undefined, true, true)]) {
    expect((await s.send()).status).toBe(201); expect(s.notices.deferred().items).toHaveLength(0);
    expect(s.log).toHaveLength(1);
  }
});
test("not_before holds even in shadow and release never runs before it", async () => {
  const s = setup("2026-10-27T13:00:00Z", false);
  expect((await s.send("report", { not_before: "2026-10-28T13:00:00Z" })).status).toBe(202);
  const now = "2026-10-27T14:00:00Z";
  expect(s.notices.release(parseTs(now), policy(evaluateHumanPosture({}, now), now), DEFAULT_POSTURE_CONFIG.tz)).toBeNull();
  expect(s.notices.deferred().items).toHaveLength(1);
});
test("release is a single bounded digest, day only after 08:00, survives restart", async () => {
  const s = setup(); await s.send(); await s.send();
  const restored = new NoticeService(s.root);
  for (const now of ["2026-10-28T02:35:00Z", "2026-10-28T11:59:00Z"]) {
    expect(restored.release(parseTs(now), policy(evaluateHumanPosture({}, now), now), DEFAULT_POSTURE_CONFIG.tz)).toBeNull();
  }
  const now = "2026-10-28T12:00:00Z", d = policy(evaluateHumanPosture({}, now), now);
  const digest = restored.release(parseTs(now), d, DEFAULT_POSTURE_CONFIG.tz);
  expect(digest?.title).toBe("Held overnight: 2 updates"); expect(digest?.body).toContain("Synthetic update");
  expect(restored.release(parseTs(now), d, DEFAULT_POSTURE_CONFIG.tz)).toBeNull();
  expect(new NoticeService(s.root).deferred().items).toHaveLength(0);
  expect(JSON.parse(readFileSync(join(s.root, "notices-deferred.json"), "utf8")).items).toEqual([]);
});
test("deferred queue drops oldest over 200 with persisted counter and bounded digest", () => {
  const s = setup();
  for (let i = 0; i < 203; i++) s.notices.hold({ title: `Synthetic ${i}`, body: "Ready" }, null);
  expect(s.notices.deferred().items).toHaveLength(200); expect(s.notices.deferred().dropped).toBe(3);
  expect(new NoticeService(s.root).deferred().items[0]?.input.title).toBe("Synthetic 3");
  const now = "2026-10-28T13:00:00Z";
  expect(s.notices.release(parseTs(now), policy(evaluateHumanPosture({}, now), now), DEFAULT_POSTURE_CONFIG.tz)?.body.length).toBeLessThanOrEqual(600);
});
test("parallel bridge submissions cannot race past C3", async () => {
  const s = setup("2026-10-27T13:00:00Z");
  const responses = await Promise.all(Array.from({ length: 5 }, () => s.send("decision")));
  expect(responses.map(r => r.status)).toEqual([201, 201, 201, 202, 202]);
});
test("CLI accepts held response and --class through the real wrapper", async () => {
  const s = setup();
  writeFileSync(join(s.root, "token"), "synthetic-token");
  const server = startNoticeServer({ token: "synthetic-token", notices: s.notices, port: 0,
    file: join(s.root, "posture.json"), configFile: join(s.root, "config.json"), now: () => parseTs("2026-10-28T02:30:00Z") });
  try {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../bin/dash-notify"), "Synthetic", "Ready", "--class", "decision"], {
      env: { ...process.env, DASH_CREDENTIAL_DIR: s.root, DASH_NOTICE_PORT: String(server.port) }, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0); expect(await new Response(proc.stdout).text()).toContain("held");
    expect(s.notices.list()).toHaveLength(0); expect(s.notices.deferred().items[0]?.input.class).toBe("decision");
  } finally { server.stop(true); }
});
for (const restart of [false, true]) {
  for (const change of ["ingress", "eligibility", "history eviction"]) {
    test(`real clear failure never repeats a title after ${change}; restart=${restart}`, () => {
      const s = setup();
      s.notices.hold({ title: "Synthetic A", body: "Ready" }, null);
      if (change === "eligibility") s.notices.hold({ title: "Synthetic B", body: "Ready", not_before: "2026-10-28T14:00:00Z" }, null);
      const now = "2026-10-28T13:00:00Z", later = "2026-10-28T14:00:00Z";
      const seen: NoticeMessage[] = [];
      s.notices.subscribe(n => seen.push(n));
      const obstruction = join(s.root, "notices-deferred.json.tmp");
      mkdirSync(obstruction);
      expect(() => s.notices.release(parseTs(now), policy(evaluateHumanPosture({}, now), now), DEFAULT_POSTURE_CONFIG.tz)).toThrow();
      expect(seen.map(n => n.body)).toEqual(["Synthetic A"]);
      expect(s.notices.list().map(n => n.body)).toEqual(["Synthetic A"]);
      expect(s.notices.deferred().items[0]?.input.title).toBe("Synthetic A");
      rmSync(obstruction, { recursive: true });
      const current = restart ? new NoticeService(s.root) : s.notices;
      const retried: NoticeMessage[] = [];
      // subscribe replays history, so observe only new broadcasts below.
      current.subscribe(n => retried.push(n)); retried.length = 0;
      if (change !== "eligibility") current.hold({ title: "Synthetic B", body: "Ready" }, null);
      if (change === "history eviction") {
        for (let i = 0; i < 51; i++) current.publish({ title: `Synthetic live ${i}`, body: "Live" });
        retried.length = 0;
      }
      const recovered = restart ? new NoticeService(s.root) : current;
      if (restart) { recovered.subscribe(n => retried.push(n)); retried.length = 0; }
      const d = policy(evaluateHumanPosture({}, later), later);
      expect(recovered.release(parseTs(later), d, DEFAULT_POSTURE_CONFIG.tz)?.body).toBe("Synthetic B");
      expect(retried.map(n => n.body)).toEqual(["Synthetic B"]);
      expect(recovered.list().filter(n => n.body.includes("Synthetic A"))).toHaveLength(change === "history eviction" ? 0 : 1);
      expect(recovered.deferred().items).toHaveLength(0);
      expect(new NoticeService(s.root).deferred().items).toHaveLength(0);
      expect(recovered.release(parseTs(later), d, DEFAULT_POSTURE_CONFIG.tz)).toBeNull();
    });
  }
}

test("failed digest history write neither broadcasts nor acknowledges held items", () => {
  const s = setup(); s.notices.hold({ title: "Synthetic A", body: "Ready" }, null);
  const seen: NoticeMessage[] = []; s.notices.subscribe(n => seen.push(n));
  const obstruction = join(s.root, "notices.json.tmp"); mkdirSync(obstruction);
  const now = "2026-10-28T13:00:00Z", d = policy(evaluateHumanPosture({}, now), now);
  expect(() => s.notices.release(parseTs(now), d, DEFAULT_POSTURE_CONFIG.tz)).toThrow();
  expect(seen).toHaveLength(0); expect(s.notices.list()).toHaveLength(0);
  rmSync(obstruction, { recursive: true });
  const restored = new NoticeService(s.root);
  expect(restored.release(parseTs(now), d, DEFAULT_POSTURE_CONFIG.tz)?.body).toBe("Synthetic A");
  expect(restored.deferred().items).toHaveLength(0);
  expect(statSync(join(s.root, "notices.json")).mode & 0o777).toBe(0o600);
});

test("legacy history migrates to bounded validated delivery receipts", () => {
  const s = setup(), path = join(s.root, "notices.json");
  const legacy: NoticeMessage = { type: "notice", id: "synthetic-id", title: "Synthetic legacy", body: "Ready" };
  writeFileSync(path, JSON.stringify([legacy]));
  const restored = new NoticeService(s.root);
  expect(restored.list()).toEqual([legacy]);
  restored.publish({ title: "Synthetic new", body: "Ready" });
  expect(new NoticeService(s.root).list()).toHaveLength(2);
  for (const releasedIds of [null, [1], Array(201).fill("synthetic-id")]) {
    writeFileSync(path, JSON.stringify({ schema: "dash.notice_history/v1", items: [legacy], releasedIds }));
    expect(() => new NoticeService(s.root)).toThrow("Invalid release receipts");
  }
});

test("release retry after clearing fails does not publish a second digest", () => {
  const s = setup(); s.notices.hold({ title: "Synthetic", body: "Ready" }, null);
  const saved = readFileSync(join(s.root, "notices-deferred.json"), "utf8");
  const now = "2026-10-28T13:00:00Z", d = policy(evaluateHumanPosture({}, now), now);
  s.notices.release(parseTs(now), d, DEFAULT_POSTURE_CONFIG.tz);
  writeFileSync(join(s.root, "notices-deferred.json"), saved);
  const restored = new NoticeService(s.root); restored.release(parseTs(now), d, DEFAULT_POSTURE_CONFIG.tz);
  expect(restored.list()).toHaveLength(1); expect(restored.deferred().items).toHaveLength(0);
});
