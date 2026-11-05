#!/usr/bin/env node
/** Real-data, read-only Orchestra proof. Use an isolated bridge/token and Metro. */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const web = process.argv[2] || "http://127.0.0.1:8098";
const bridge = process.argv[3] || "http://127.0.0.1:4878";
const out = process.argv[4];
assert(out && process.env.ORCHESTRA_PROOF_TOKEN_FILE, "Pass output dir and isolated ORCHESTRA_PROOF_TOKEN_FILE");
const token = (await readFile(process.env.ORCHESTRA_PROOF_TOKEN_FILE, "utf8")).trim();
await mkdir(out, { recursive: true });
const denied = await fetch(`${bridge}/orchestra/graph`);
assert.equal(denied.status, 401);
const response = await fetch(`${bridge}/orchestra/graph`, { headers: { Authorization: `Bearer ${token}` } });
assert.equal(response.status, 200);
const graph = await response.json();
await writeFile(`${out}/endpoint-graph.json`, JSON.stringify(graph, null, 2));
const evidence = { source: "Actual isolated bridge endpoint; native state.db + manifests + systemd + cached fleet health + supervision. Debug seed is navigation/chrome only; graph is not a fixture.", web, bridge, status: response.status, unauthorized: denied.status, viewport: { width: 412, height: 915 }, nodes: {}, edges: {}, legends: {}, errors: [], assertions: [] };
for (const key of ["chat", "subagent", "repo", "host"]) evidence.nodes[key] = graph.nodes.filter(n => n.kind === key).length;
for (const key of ["delegated", "touched", "hosted", "workspace"]) evidence.edges[key] = graph.edges.filter(e => e.relation === key).length;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: evidence.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", e => evidence.errors.push(e.message));
  // Browser cannot use the seeded fake bridge. Forward only this read endpoint to
  // the real isolated copy; never intercept a response with generated graph data.
  await page.route("**/orchestra/graph", async route => {
    const real = await fetch(`${bridge}/orchestra/graph`, { headers: { Authorization: `Bearer ${token}` } });
    await route.fulfill({ status: real.status, contentType: "application/json", body: await real.text() });
  });
  await page.goto(`${web}/?debug=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready);
  await page.evaluate(() => window.__DASH_DEBUG__.scenario("main-orchestra"));
  await page.waitForTimeout(2500);
  const initial = graph.nodes.some(n => n.state === "needs-you") ? "Triage" : "Fleet";
  await page.screenshot({ path: `${out}/initial.png` });
  await writeFile(`${out}/initial.txt`, await page.locator("body").innerText());
  assert(await page.getByText(initial === "Triage" ? /^Needs you · / : /^groot$/, { exact: false }).first().isVisible(), "default view follows real needs queue");
  for (const name of ["Fleet", "Lineage", "Work", "Triage"]) {
    await page.getByRole("button", { name, exact: true }).tap();
    await page.waitForTimeout(450);
    evidence.legends[name] = await page.getByRole("button", { name: /^Legend / }).allTextContents();
    assert(evidence.legends[name].length > 0);
    await page.screenshot({ path: `${out}/${name.toLowerCase()}.png` });
    await writeFile(`${out}/${name.toLowerCase()}.txt`, await page.locator("body").innerText());
  }
  const combined = Object.values(evidence.legends).flat().join(" ");
  for (const kind of ["chat", "subagent", "host", "repo", "delegated", "touched", "hosted", "workspace"]) assert(combined.includes(kind), `${kind} visible in some view legend`);
  await page.getByRole("button", { name: "Lineage", exact: true }).tap();
  const workerLegend = page.getByRole("button", { name: "Legend subagent", exact: true });
  await workerLegend.tap();
  await page.screenshot({ path: `${out}/legend-highlight.png` });
  const b = await workerLegend.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("button", { name: /^chat: / }).count(), 0);
  await page.screenshot({ path: `${out}/legend-only.png` });
  await page.getByText("Reset", { exact: true }).tap();
  await page.getByRole("button", { name: "Triage", exact: true }).tap();
  await page.getByRole("button", { name: /^(subagent|chat): / }).first().tap();
  assert(await page.getByLabel("Node details", { exact: true }).isVisible());
  await page.screenshot({ path: `${out}/details.png` });
  evidence.assertions.push("default view follows queue", "all four named questions render real data", "all eight legend kinds/relations present across views", "tap highlight and long-press kind-only", "node detail sheet opens", "unauthorized GET returns 401");
  assert.deepEqual(evidence.errors, []);
} finally {
  await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ status: evidence.status, nodes: evidence.nodes, edges: evidence.edges, errors: evidence.errors, assertions: evidence.assertions }));
