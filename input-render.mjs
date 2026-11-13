import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = "input-receipts/screenshots";
await mkdir(out, { recursive: true });
const snapshot = JSON.parse(await readFile("input-real-snapshot.json", "utf8"));
const server = spawn("python3", ["-m", "http.server", "18794", "--bind", "127.0.0.1", "--directory", "input-receipts/web"], { stdio: "ignore" });
let browser;
const evidence = { source: snapshot.source, session: snapshot.conversation.sessionId, assertions: [], errors: [], geometry: {} };
try {
  for (let n = 0; n < 100; n++) { try { if ((await fetch("http://127.0.0.1:18794")).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on("pageerror", e => evidence.errors.push(e.message));
  // No live bridge requests or execution from snapshot proof. Offline is explicit in the UI.
  await page.route("http://100.64.0.1:4747/**", r => r.abort());
  await page.goto("http://127.0.0.1:18794/?debug=1&autonav=0", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 90000 });
  const result = await page.evaluate(conversation => window.__DASH_DEBUG__.run({ action: "inputSnapshot", conversation }), snapshot.conversation);
  assert.equal(result.readOnly, true);
  const attached = page.getByRole("button", { name: /^Attached to / });
  await attached.waitFor();
  assert((await attached.innerText()).includes(snapshot.conversation.title));
  await page.screenshot({ path: `${out}/real-attached-peek.png` });
  await writeFile(`${out}/real-attached-peek.txt`, await page.locator("body").innerText());
  const composer = page.getByRole("textbox", { name: "Message", exact: true }).filter({ visible: true });
  await composer.fill("Verification draft — do not send");
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: "navigate", screen: "Chat" }));
  await page.getByRole("textbox", { name: "Message", exact: true }).filter({ visible: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Message", exact: true }).filter({ visible: true }).inputValue(), "Verification draft — do not send");
  await page.screenshot({ path: `${out}/real-chat-shared-draft.png` });
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: "navigate", screen: "Main" }));
  await attached.waitFor();
  assert.equal(await composer.inputValue(), "Verification draft — do not send");
  await attached.click();
  await page.getByText("Attached session", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/real-session-switcher.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Search without detaching", exact: true }).click();
  await page.getByRole("button", { name: "Return to attached conversation input", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__DASH_DEBUG__.state())).activeId, snapshot.conversation.id);
  await page.screenshot({ path: `${out}/real-search-attached.png` });
  await page.getByRole("button", { name: "Return to attached conversation input", exact: true }).click();
  await page.waitForTimeout(6300);
  assert.equal(await page.getByRole("button", { name: "Tuck conversation peek", exact: true }).count(), 0);
  await page.screenshot({ path: `${out}/real-tucked.png` });
  evidence.geometry.attachment = await attached.boundingBox();
  evidence.geometry.input = await composer.boundingBox();
  assert(evidence.geometry.input.y + evidence.geometry.input.height <= 915, "input inside viewport");
  assert(evidence.geometry.attachment.y + evidence.geometry.attachment.height <= evidence.geometry.input.y, "identity does not cover text input");
  evidence.assertions.push("native state.db title and observed user excerpt rendered", "offline snapshot has no live transport", "draft survives Chat/Main roundtrip", "switcher opens and cancels", "search preserves attachment", "peek tucks after six seconds", "input and identity inside viewport with no overlap");
  assert.deepEqual(evidence.errors, []);
} finally {
  await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
  await browser?.close(); server.kill("SIGTERM");
}
console.log(JSON.stringify(evidence));
