#!/usr/bin/env bun
// Live Trace proof: the production Trace screen (web export) reads the real read-only collector
// through the same route the bridge registers (createTraceRoute) on an owned loopback server.
// Usage: bun scripts/trace-live-proof.ts <private-out-dir> <web-export-dir>
// Env: PLAYWRIGHT_MODULE (path to a playwright package), TRACE_EVENT_CMD (shell command that
// produces a new real source event, e.g. a tiny fleet-build job). Not device acceptance.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createTraceRoute } from "../bridge/src/trace-route";
import { bearerToken, secretMatches } from "../bridge/src/bridge-security";
import { parseTraceSnapshot } from "../app/src/trace/model";

const out = resolve(process.argv[2] ?? "trace-live-receipts"), dist = resolve(process.argv[3] ?? "app/dist-trace-web");
mkdirSync(out, { recursive: true, mode: 0o700 });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const token = randomBytes(32).toString("hex");
const route = createTraceRoute({ authorize: async r => secretMatches(bearerToken(r), token) });
const cors = (response: Response, origin: string | null) => {
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  return response;
};
let port = 0;
let live: ReturnType<typeof Bun.serve> | null = null;
function startLive() {
  live = Bun.serve({ hostname: "127.0.0.1", port, fetch: async request => {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);
    return cors(await route(request) ?? new Response("not found", { status: 404 }), origin);
  } });
  port = live.port ?? 0;
}
function stopLive() { live?.stop(true); live = null; }
// Reserve a port, then release it so the first app poll meets a real refused connection.
startLive(); stopLive();

const web = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
  const path = resolve(dist, "." + new URL(request.url).pathname);
  if (!path.startsWith(dist)) return new Response("no", { status: 404 });
  let file = path;
  try { if (statSync(file).isDirectory()) file = resolve(file, "index.html"); } catch { file = resolve(dist, "index.html"); }
  const type = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".css": "text/css", ".ttf": "font/ttf", ".png": "image/png" }[extname(file)] ?? "application/octet-stream";
  return new Response(Bun.file(file), { headers: { "Content-Type": type } });
} });

type Step = { step: string; ok: boolean; detail?: string; shot?: string; ms?: number };
const result: { status: string; scope: string; widths: Record<number, Step[]>; errors: string[]; newEvent?: string; eventCommandExit?: number | null } = {
  status: "RUNNING",
  scope: "Production Trace (Expo web export, debug hooks only for pairing) + real read-only collector on groot via createTraceRoute on owned loopback. Not native-device acceptance.",
  widths: {}, errors: [],
};
const browser = await chromium.launch({ headless: true });
const isPrivate = (key: string) => key.startsWith("hermes:");
try {
  for (const width of [412, 390]) {
    const steps: Step[] = result.widths[width] = [];
    const shot = async (page: { screenshot(o: { path: string }): Promise<unknown> }, name: string) => { const p = `${out}/${width}-${name}.png`; await page.screenshot({ path: p }); return p; };
    const check = (step: string, ok: boolean, detail?: string, shotPath?: string) => { steps.push({ step, ok, detail, shot: shotPath }); assert(ok, `${width}: ${step}${detail ? ` (${detail})` : ""}`); };
    const context = await browser.newContext({ viewport: { width, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", (e: Error) => result.errors.push(`${width}: ${e.message}`));
    await page.route("**/orchestra/graph", (r: { fulfill(o: object): Promise<void> }) => r.fulfill({ status: 503, body: "unavailable" }));
    await page.goto(`http://127.0.0.1:${web.port}/?debug=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction("window.__DASH_DEBUG__?.ready", undefined, { timeout: 120000 });
    await page.evaluate("window.__noReload = 1");
    const run = (cmd: object) => page.evaluate(`window.__DASH_DEBUG__.run(${JSON.stringify(cmd)})`);
    stopLive();
    await run({ action: "contextTarget", address: `127.0.0.1:${port}`, token, session: "not-a-live-chat" });
    await run({ action: "navigate", screen: "Trace" });
    await page.getByTestId("trace-feed-unavailable").waitFor({ timeout: 30000 });
    const downText = await page.getByTestId("trace-feed-unavailable").innerText();
    check("bridge down: explicit unavailable state, no rows", downText.includes("Live trace unavailable") && await page.locator('[data-testid^="row-"]').count() === 0, downText.split("\n")[0], await shot(page, "1-unavailable"));

    startLive();
    const t0 = Date.now();
    await page.getByTestId("trace-feed-live").waitFor({ timeout: 30000 });
    const initial: string[] = await page.locator('[data-testid^="row-"]').evaluateAll((els: Element[]) => els.map(e => e.getAttribute("data-testid")?.slice(4) ?? ""));
    steps.push({ step: "bridge up: live rows without reload", ok: initial.length > 0, ms: Date.now() - t0, detail: `${initial.length} rows; kinds ${[...new Set(initial.map(k => k.split(":")[0]))].join(",")}`, shot: await shot(page, "2-live") });
    assert(initial.length > 0);
    check("no page reload during reconnect", await page.evaluate("window.__noReload === 1") === true);

    const snapshot = parseTraceSnapshot(await (await fetch(`http://127.0.0.1:${port}/trace/snapshot`, { headers: { Authorization: `Bearer ${token}` } })).json());
    const selected = snapshot.rows.find(r => r.key.startsWith("run:") && r.evidence?.quote) ?? snapshot.rows.find(r => r.evidence?.quote);
    assert(selected, "a real row with an original request exists");
    const row = page.getByTestId(`row-${selected.key}`);
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await page.getByTestId("trace-provenance").waitFor({ timeout: 15000 });
    const prov = await page.getByTestId("trace-provenance").innerText();
    check("selected real row opens with its own key and source provenance", prov.includes(`Event · ${selected.key}`) && /Source · \//.test(prov) && /Request hash · [a-f0-9]{12}/.test(prov), isPrivate(selected.key) ? "hermes session (key withheld)" : selected.key, await shot(page, "3-detail"));
    const evidenceText = await page.getByTestId("trace-evidence").innerText();
    check("detail shows the verbatim request and validation section", evidenceText.includes("You asked") && evidenceText.includes("VALIDATION") && evidenceText.includes("ARTIFACTS"));

    if (width === 412) {
      const before = new Set(snapshot.rows.map(r => r.key));
      const cmd = process.env.TRACE_EVENT_CMD;
      assert(cmd, "TRACE_EVENT_CMD produces a real new source event");
      const ev = spawnSync("bash", ["-c", cmd], { encoding: "utf8", timeout: 240000 });
      result.eventCommandExit = ev.status;
      const t1 = Date.now();
      let fresh = "";
      for (let i = 0; i < 60 && !fresh; i++) {
        const keys: string[] = await page.locator('[data-testid^="row-"]').evaluateAll((els: Element[]) => els.map(e => e.getAttribute("data-testid")?.slice(4) ?? ""));
        fresh = keys.find(k => k.startsWith("fleet:") && !before.has(k)) ?? "";
        if (!fresh) await page.waitForTimeout(1000);
      }
      result.newEvent = fresh;
      check("new real fleet event appears in rendered Trace without reload", Boolean(fresh) && await page.evaluate("window.__noReload === 1") === true, `${fresh} after ${Date.now() - t1} ms`);
      const still = await page.getByTestId("trace-provenance").innerText();
      check("open detail keeps the selected row while the feed updates", still.includes(`Event · ${selected.key}`), undefined, await shot(page, "4-detail-after-new-event"));
      await page.getByRole("button", { name: "Close", exact: true }).tap();
      await page.getByTestId("trace-detail").waitFor({ state: "hidden" });
      const arrivedText = await page.getByTestId("trace-arrived").innerText().catch(() => "");
      const newRow = page.getByTestId(`row-${fresh}`);
      await newRow.scrollIntoViewIfNeeded();
      check("arrival line names the new event", arrivedText.includes(fresh.replace(/^fleet:/, "").replace(/\.log$/, "")), arrivedText, await shot(page, "5-new-event-row"));
      await newRow.tap();
      await page.getByTestId("trace-provenance").waitFor();
      const newProv = await page.getByTestId("trace-provenance").innerText();
      check("new event detail shows its fleet receipt source", newProv.includes(`Event · ${fresh}`) && newProv.includes("/fleet/runs/"), undefined, await shot(page, "6-new-event-detail"));
      await page.getByRole("button", { name: "Close", exact: true }).tap();
      await page.getByTestId("trace-detail").waitFor({ state: "hidden" });
    } else {
      await page.getByRole("button", { name: "Close", exact: true }).tap();
      await page.getByTestId("trace-detail").waitFor({ state: "hidden" });
    }

    await page.getByRole("button", { name: "Component lab", exact: true }).click();
    await page.getByTestId("lab-demo-label").waitFor();
    check("Component Lab is labelled demo data", (await page.getByTestId("lab-demo-label").innerText()).startsWith("DEMO DATA"), undefined, await shot(page, "7-lab-demo"));
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByTestId("trace-feed-live").waitFor({ timeout: 15000 });
    check("Back from Lab returns to live Trace rows", await page.locator('[data-testid^="row-"]').count() > 0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal page overflow", overflow <= width + 1, `${overflow}px`);

    stopLive();
    await page.getByTestId("trace-feed-unavailable").waitFor({ timeout: 30000 });
    const lost = await page.getByTestId("trace-feed-unavailable").innerText();
    check("bridge lost: explicit unavailable with last-live note, rows cleared", lost.includes("Last live update") && await page.locator('[data-testid^="row-"]').count() === 0, lost.split("\n")[0], await shot(page, "8-lost"));
    startLive();
    await page.getByTestId("trace-feed-live").waitFor({ timeout: 30000 });
    check("bridge back: reconnects to live rows without reload", await page.locator('[data-testid^="row-"]').count() > 0 && await page.evaluate("window.__noReload === 1") === true, undefined, await shot(page, "9-reconnected"));
    await context.close();
  }
  assert.deepEqual(result.errors, []);
  result.status = "PASS";
} catch (e) {
  result.status = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  process.exitCode = 1;
} finally {
  writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
  await browser.close(); stopLive(); web.stop(true);
  console.log(JSON.stringify({ status: result.status, newEvent: result.newEvent, steps: Object.fromEntries(Object.entries(result.widths).map(([w, s]) => [w, s.filter(x => x.ok).length + "/" + s.length])) }));
}
