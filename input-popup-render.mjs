import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.INPUT_SCREENSHOT_DIR ?? "input-receipts/screenshots";
await mkdir(out, { recursive: true });
const snapshot = JSON.parse(await readFile("input-real-snapshot.json", "utf8"));
const models = JSON.parse(await readFile("input-real-models.json", "utf8"));
const server = spawn("python3", ["-m", "http.server", "18795", "--bind", "127.0.0.1", "--directory", "input-receipts/web"], { stdio: "ignore" });
let browser;
const evidence = { source: models.source, session: snapshot.conversation.sessionId, modelPairs: models.models.length, catalogPairs: models.catalog.length, assertions: [], errors: [] };
try {
  for (let n = 0; n < 100; n++) { try { if ((await fetch("http://127.0.0.1:18795")).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on("pageerror", e => evidence.errors.push(e.message));
  await page.route("http://100.64.0.1:4747/**", r => r.abort());
  await page.goto("http://127.0.0.1:18795/?debug=1&autonav=0", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 90000 });
  assert.equal((await page.evaluate(conversation => window.__DASH_DEBUG__.run({ action: "inputSnapshot", conversation }), snapshot.conversation)).readOnly, true);
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: "navigate", screen: "Chat" }));
  // NavigationContainer linking drops query parameters; explicitly retain proof-only debug mode.
  await page.evaluate(() => window.history.replaceState(null, "", `${location.pathname}?debug=1&autonav=0`));
  assert.equal((await page.evaluate(value => window.__DASH_DEBUG__.run({ action: "inputModels", snapshot: value }), models)).readOnly, true);
  const button = page.getByRole("button", { name: /^Agent controls/ });
  await button.click();
  await page.getByRole("button", { name: /^Model,/ }).waitFor();
  await page.screenshot({ path: `${out}/real-agent-popup.png` });
  await page.getByRole("button", { name: /^Model,/ }).click();
  await page.getByRole("textbox", { name: "Search models", exact: true }).waitFor();
  const top = models.models.slice(0, 4);
  for (const model of top) assert.equal(await page.getByRole("button", { name: `Inspect ${model.provider}/${model.model}, ${model.count} sessions`, exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: /^Inspect xai\// }).count(), 0);
  await page.screenshot({ path: `${out}/real-recent-models.png` });
  await writeFile(`${out}/real-recent-models.txt`, await page.locator("body").innerText());
  if (top[0]) {
    const model = top[0];
    await page.getByRole("button", { name: `Inspect ${model.provider}/${model.model}, ${model.count} sessions`, exact: true }).click();
    assert((await page.locator("body").innerText()).includes("This did not change the session model"));
    await page.getByRole("textbox", { name: "Search models", exact: true }).fill(model.model);
    await page.screenshot({ path: `${out}/real-model-search.png` });
  }
  await page.getByRole("button", { name: "Close model search", exact: true }).click();
  await button.click();
  await page.getByRole("button", { name: "Harness, hermes", exact: true }).click();
  await page.screenshot({ path: `${out}/harness-picker-offline.png` });
  evidence.assertions.push("real native session and provider-model cache snapshot, not invented counts", "top four recent provider/model pairs appear", "cancelled xai provider absent", "search and inspect do not claim model application", "existing harness picker opens", "no native command, provider inference or approval sent");
  assert.deepEqual(evidence.errors, []);
} finally {
  await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
  await browser?.close(); server.kill("SIGTERM");
}
console.log(JSON.stringify(evidence));
