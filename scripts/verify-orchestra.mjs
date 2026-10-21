#!/usr/bin/env node
/** Isolated Expo web proof. Export EXPO_PUBLIC_DEBUG=1; serve build; pass URL and output dir. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const url = process.argv[2] ?? "http://127.0.0.1:8108";
const out = resolve(process.argv[3] ?? "screenshots/orchestra");
await mkdir(`${out}/frames`, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const evidence = { url, viewport: { width: 412, height: 915 }, hasTouch: true, source: "Exported Expo web, debug fixtures explicitly labelled", controls: [], sequences: {}, gestures: {}, errors };
async function boot(context, scenario) {
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${url}?debug=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready);
  await page.evaluate(id => window.__DASH_DEBUG__.scenario(id), scenario);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  return page;
}
async function frames(page, name, target, action) {
  const result = [];
  result.push({ ms: 0, box: await target.boundingBox() });
  const started = Date.now();
  await action();
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(45);
    result.push({ ms: Date.now() - started, box: await target.boundingBox() });
    await page.screenshot({ path: `${out}/frames/${name}-${i}.png` });
  }
  evidence.sequences[name] = result;
  assert(new Set(result.map(item => `${Math.round(item.box.x)},${Math.round(item.box.y)},${Math.round(item.box.width)}`)).size >= 3, `${name} must have intermediate positions`);
  await page.waitForTimeout(700);
}
async function touch(client, type, points) {
  await client.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
}
try {
  const context = await browser.newContext({ viewport: evidence.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await boot(context, "main-orchestra");
  assert.equal(await page.getByLabel("Composer suggestions", { exact: true }).count(), 0, "No empty suggestion pills at rest");
  await page.screenshot({ path: `${out}/after.png` });
  for (const label of ["Spine", "Constellation", "Radial", "Islands", "All", "Reset", "Approvals, 2 pending", "New chat", "Settings"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    const box = await button.boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `${label}: 44px target`);
    assert(box.y >= 650 && box.y + box.height <= 855, `${label}: thumb-zone bounds`);
    evidence.controls.push({ label, box });
  }
  const hostNames = await page.evaluate(() => window.__DASH_DEBUG__.state().connection.hosts.map(host => ({ id: host.id, name: host.name })));
  assert.equal(hostNames.find(host => host.id === "0")?.name, "groot");
  evidence.hostNames = hostNames;
  for (const [label, screenTitle] of [["Settings", "Settings"], ["Approvals, 2 pending", "Approvals"], ["New chat", "OMP"]]) {
    await page.getByRole("button", { name: label, exact: true }).tap();
    await page.waitForTimeout(400);
    assert((await page.locator("body").innerText()).includes(screenTitle), `${label} must navigate`);
    await page.evaluate(() => window.__DASH_DEBUG__.scenario("main-orchestra"));
    await page.waitForTimeout(600);
  }
  const emptyLegend = page.getByRole("button", { name: "Legend subagent", exact: true });
  const emptyBox = await emptyLegend.boundingBox();
  const emptyClient = await context.newCDPSession(page);
  await touch(emptyClient, "touchStart", [[emptyBox.x + emptyBox.width / 2, emptyBox.y + emptyBox.height / 2]]);
  await page.waitForTimeout(650);
  await touch(emptyClient, "touchEnd", []);
  await page.waitForTimeout(700);
  assert.equal(await page.getByText("0 shown", { exact: true }).count(), 1);
  assert(await page.getByText("No subagent reported. Tap the legend again or Reset.", { exact: true }).isVisible());
  await page.screenshot({ path: `${out}/legend-empty.png` });
  await page.getByRole("button", { name: "Reset", exact: true }).tap();
  await page.evaluate(() => window.__DASH_DEBUG__.scenario("orchestra-motion"));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/fixture-spine.png` });
  assert.equal(await page.getByText("13 shown", { exact: true }).count(), 1);
  const node = page.getByRole("button", { name: "chat: Orchestra UX, live", exact: true });
  await frames(page, "layout", node, () => page.getByRole("button", { name: "Constellation", exact: true }).tap());
  await page.screenshot({ path: `${out}/fixture-constellation.png` });
  await frames(page, "focus", node, () => node.tap());
  assert.equal(await page.getByLabel("Node details", { exact: true }).count(), 1);
  await page.screenshot({ path: `${out}/node-focus.png` });
  await page.getByRole("button", { name: "All", exact: true }).tap();
  assert.equal(await page.getByText("5 shown", { exact: true }).count(), 1, "Focus keeps the selected node and its observed neighbours");
  await page.getByRole("button", { name: "Focus", exact: true }).tap();
  assert.equal(await page.getByText("13 shown", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Close", exact: true }).tap();
  await page.waitForTimeout(800);
  const chatLegend = page.getByRole("button", { name: "Legend chat", exact: true });
  await chatLegend.tap();
  assert.equal(await page.getByText("13 shown · 9 highlighted", { exact: true }).count(), 1);
  await page.screenshot({ path: `${out}/legend-highlight.png` });
  await chatLegend.tap();
  assert.equal(await page.getByText("13 shown", { exact: true }).count(), 1);
  const subagentLegend = page.getByRole("button", { name: "Legend subagent", exact: true });
  const box = await subagentLegend.boundingBox();
  const client = await context.newCDPSession(page);
  await touch(client, "touchStart", [[box.x + box.width / 2, box.y + box.height / 2]]);
  await page.waitForTimeout(650);
  await touch(client, "touchEnd", []);
  await page.waitForTimeout(800);
  assert.equal(await page.getByText("2 shown", { exact: true }).count(), 1);
  await page.screenshot({ path: `${out}/legend-only.png` });
  await subagentLegend.tap();
  assert.equal(await page.getByText("13 shown", { exact: true }).count(), 1);
  for (const name of ["Radial", "Islands"]) {
    await page.getByRole("button", { name, exact: true }).tap();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/fixture-${name.toLowerCase()}.png` });
  }
  await page.getByRole("button", { name: "Reset", exact: true }).tap();
  await page.waitForTimeout(700);
  const transform = page.getByTestId("orchestra-map-transform");
  const beforePan = await transform.evaluate(n => n.style.transform);
  await touch(client, "touchStart", [[200, 390]]);
  for (let i = 1; i <= 8; i++) { await touch(client, "touchMove", [[200 + i * 6, 390 + i * 3]]); await page.waitForTimeout(25); }
  await touch(client, "touchEnd", []);
  const afterPan = await transform.evaluate(n => n.style.transform);
  assert.notEqual(afterPan, beforePan, "Pan must change the graph transform");
  await touch(client, "touchStart", [[160, 350], [240, 350]]);
  for (let i = 1; i <= 8; i++) { await touch(client, "touchMove", [[160 - i * 4, 350], [240 + i * 4, 350]]); await page.waitForTimeout(25); }
  await touch(client, "touchEnd", []);
  const afterPinch = await transform.evaluate(n => n.style.transform);
  assert.notEqual(afterPinch, afterPan, "Pinch must change the graph transform");
  evidence.gestures = { beforePan, afterPan, afterPinch };
  await page.screenshot({ path: `${out}/pinch-pan.png` });
  await page.getByRole("button", { name: "Reset", exact: true }).tap();
  await page.waitForTimeout(800);
  const flowing = page.getByTestId("orchestra-graph").locator("svg circle");
  const flowBefore = await flowing.evaluateAll(nodes => nodes.map(n => ({ x: n.getAttribute("cx"), y: n.getAttribute("cy") })));
  await page.waitForTimeout(300);
  const flowAfter = await flowing.evaluateAll(nodes => nodes.map(n => ({ x: n.getAttribute("cx"), y: n.getAttribute("cy") })));
  assert.notDeepEqual(flowAfter, flowBefore, "Active delegation particles must move");
  evidence.flow = { before: flowBefore, after: flowAfter };
  await page.evaluate(() => window.__DASH_DEBUG__.scenario("chat"));
  await page.waitForTimeout(800);
  for (const label of ["Choose harness", "Review 2 approvals, preview only"]) {
    const box = await page.getByRole("button", { name: label, exact: true }).boundingBox();
    assert(box && box.y > 650 && box.height >= 44, `${label} must be in the chat thumb zone`);
  }
  await page.screenshot({ path: `${out}/chat-thumb-zone.png` });
  await context.close();
  const reducedContext = await browser.newContext({ viewport: evidence.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const reducedPage = await boot(reducedContext, "orchestra-motion");
  await reducedPage.getByRole("button", { name: "Radial", exact: true }).tap();
  await reducedPage.waitForTimeout(150);
  const reducedNode = reducedPage.getByRole("button", { name: "chat: Orchestra UX, live", exact: true });
  const reducedA = await reducedNode.boundingBox();
  await reducedPage.waitForTimeout(400);
  const reducedB = await reducedNode.boundingBox();
  assert.deepEqual(reducedA, reducedB, "Reduced motion must settle without spring frames");
  assert.equal(await reducedPage.getByTestId("orchestra-graph").locator("svg circle").count(), 0, "Reduced motion suppresses flowing particles");
  await reducedPage.screenshot({ path: `${out}/reduced-motion.png` });
  evidence.reducedMotion = { before: reducedA, after: reducedB, flowingParticles: 0 };
  await reducedContext.close();
  assert.deepEqual(errors, []);
  evidence.result = "PASS";
} finally {
  await writeFile(`${out}/browser-proof.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
console.log(JSON.stringify(evidence, null, 2));
