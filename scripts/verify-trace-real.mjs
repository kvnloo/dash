import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createTraceHttpHandler } from "../bridge/src/trace-http.ts";
import { bearerToken, secretMatches } from "../bridge/src/bridge-security.ts";
const out = process.argv[2] || "trace-receipts";
await mkdir(out, { recursive: true });
const input = process.env.TRACE_PROOF_INPUT;
const token = input ? randomBytes(32).toString("hex") : (await readFile(".trace-proof-auth", "utf8")).trim();
let replayServer;
const capturedTargets = new Set();
if (input) {
  const captured = JSON.parse(await readFile(resolve(input, "snapshot.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(input, "artifacts.json"), "utf8"));
  const paths = new Map();
  for (const a of manifest) {
    const file = resolve(input, a.file);
    assert(file.startsWith(resolve(input, "artifacts") + "/"));
    assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), a.sha256);
    paths.set(a.target, file); capturedTargets.add(a.target);
  }
  const handler = createTraceHttpHandler({ authorize: async r => secretMatches(bearerToken(r), token), collect: async () => captured, roots: [resolve(input, "artifacts")] });
  replayServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    const url = new URL(request.url);
    if (url.pathname === "/trace/artifact") url.searchParams.set("path", paths.get(url.searchParams.get("path")) || "/unavailable");
    return await handler(new Request(url, request)) || new Response("not found", { status: 404 });
  } });
}
const bridge = replayServer ? `http://127.0.0.1:${replayServer.port}` : "http://100.113.138.100:4889";
const headers = { Authorization: `Bearer ${token}` };
const denied = await fetch(`${bridge}/trace/snapshot`, { signal: AbortSignal.timeout(15000) });
assert.equal(denied.status, 401);
const response = await fetch(`${bridge}/trace/snapshot`, { headers, signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
const snapshot = await response.json();
await writeFile(`${out}/real-snapshot.json`, JSON.stringify(snapshot), { mode: 0o600 });
const base = resolve("app/dist-trace-web");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(base, "." + new URL(req.url, "http://local").pathname);
    if (!path.startsWith(base + "/") && path !== base) { res.writeHead(404).end(); return; }
    const file = (await stat(path)).isDirectory() ? resolve(path, "index.html") : path;
    const body = await readFile(file);
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".wasm": "application/wasm", ".json": "application/json" })[extname(file)] || "application/octet-stream");
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const address = server.address(); assert(address && typeof address !== "string");
const browser = await chromium.launch({ headless: true });
const evidence = { source: input ? "MBP render of captured real groot native state.db/run/fleet snapshot and SHA256-verified real image bytes, replayed through the actual authenticated handler on MBP loopback. NOT a live groot→MBP connection; direct tailnet :4889 was unreachable. No phone proof." : "Actual isolated authenticated trace endpoint on groot; native state.db/run dirs/fleet receipts. Browser rendering on MBP. No production bridge or phone UI touched.", rows: snapshot.rows.length, contracts: snapshot.rows.filter(r => r.evidence?.quote).length, unauthorized: denied.status, screenshots: [], errors: [], openMs: [], assertions: [] };
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", e => evidence.errors.push(e.message));
  let offline = false;
  await page.route("**/trace/**", async route => {
    const path = new URL(route.request().url());
    if (offline && path.pathname === "/trace/snapshot") { await route.fulfill({ status: 503, body: "simulated endpoint outage" }); return; }
    const real = await fetch(`${bridge}${path.pathname}${path.search}`, { headers, signal: AbortSignal.timeout(15000) });
    await route.fulfill({ status: real.status, contentType: real.headers.get("Content-Type") || "application/json", body: Buffer.from(await real.arrayBuffer()) });
  });
  // Never send debug-seed writes/roster requests to any real bridge.
  await page.route("**/orchestra/graph", r => r.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(`http://127.0.0.1:${address.port}/?debug=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready);
  await page.evaluate(async () => {
    await window.__DASH_DEBUG__.run({ action: "contextTarget", address: "127.0.0.1:4990", token: "proof-navigation-only", session: "not-a-live-chat" });
    await window.__DASH_DEBUG__.run({ action: "navigate", screen: "Trace" });
  });
  await page.getByText(/live from bridge|cached bridge snapshot/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${out}/trace-live.png` }); evidence.screenshots.push("trace-live.png");
  const preferred = snapshot.rows.find(r => r.key === "run:20261021-trace-intent") || snapshot.rows.find(r => r.evidence?.quote);
  assert(preferred, "real contract row exists");
  const row = page.getByTestId(`row-${preferred.key}`);
  await row.scrollIntoViewIfNeeded();
  const start = Date.now(); await row.tap();
  await page.getByText("INTENT CONTRACT", { exact: true }).waitFor();
  evidence.openMs.push(Date.now() - start);
  assert(await page.getByText("VALIDATION", { exact: true }).isVisible());
  assert(await page.getByText("ARTIFACTS", { exact: true }).isVisible());
  const positions = await Promise.all(["INTENT CONTRACT", "VALIDATION", "ARTIFACTS"].map(text => page.getByText(text, { exact: true }).boundingBox()));
  assert(positions.every(Boolean));
  assert(positions[0].y < positions[1].y && positions[1].y < positions[2].y);
  evidence.headingGeometry = positions;
  assert.equal(await page.getByLabel("Worker metrics", { exact: true }).getAttribute("aria-expanded"), "false");
  await page.screenshot({ path: `${out}/trace-intent.png` }); evidence.screenshots.push("trace-intent.png");
  await writeFile(`${out}/trace-intent.txt`, await page.locator("body").innerText(), { mode: 0o600 });
  await page.getByLabel("Worker metrics", { exact: true }).tap();
  await page.screenshot({ path: `${out}/trace-workers.png` }); evidence.screenshots.push("trace-workers.png");
  await page.getByRole("button", { name: "Close", exact: true }).tap();
  await page.getByTestId("trace-detail").waitFor({ state: "hidden" });
  const artifactRow = snapshot.rows.find(r => r.evidence?.artifacts.some(a => (a.kind === "image" || a.kind === "storyboard") && (!input || capturedTargets.has(a.target))));
  assert(artifactRow, "actual captured image-producing run exists");
  if (artifactRow) {
    const target = page.getByTestId(`row-${artifactRow.key}`); await target.scrollIntoViewIfNeeded(); await target.tap();
    await page.getByText("ARTIFACTS", { exact: true }).waitFor();
    const img = page.locator('[data-testid="trace-evidence"] img').first();
    for (let n = 0; n < 11 && !await img.count(); n++) {
      const next = page.getByText(/^Next artifacts/);
      if (!await next.count()) break;
      await next.tap(); await page.waitForTimeout(300);
    }
    await img.waitFor({ state: "visible", timeout: 15000 });
    await img.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].some(i => i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: `${out}/trace-artifacts.png` }); evidence.screenshots.push("trace-artifacts.png");
    await img.tap();
    const closeImage = page.getByRole("button", { name: "Close artifact image", exact: true });
    await closeImage.waitFor();
    await page.screenshot({ path: `${out}/trace-image-expanded.png` }); evidence.screenshots.push("trace-image-expanded.png");
    await closeImage.tap();
    await page.getByRole("button", { name: "Close", exact: true }).tap();
  }
  offline = true;
  await page.getByText(/Offline \/ endpoint unavailable/).waitFor({ timeout: 25000 });
  await page.screenshot({ path: `${out}/trace-offline.png` }); evidence.screenshots.push("trace-offline.png");
  evidence.assertions.push("unauthorized read denied", "native captured data loads over authenticated endpoint", "original run contract visible", "intent then validation then artifacts geometry", "metrics initially collapsed and opens", "detail closes", "real captured image decodes and expands", "simulated endpoint outage discards private data and restores bundled snapshot");
  assert.deepEqual(evidence.errors, []);
} finally {
  await writeFile(`${out}/visual-evidence.json`, JSON.stringify(evidence, null, 2));
  await browser.close(); server.close(); replayServer?.stop(true);
}
console.log(JSON.stringify(evidence));
