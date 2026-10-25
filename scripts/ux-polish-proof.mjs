/** Focused Expo web regression proof. Start an isolated debug Metro, then run:
 * node scripts/ux-polish-proof.mjs http://localhost:8128 /absolute/evidence/dir
 * Only local debug fixtures are used. No model turn, device or bridge is implied.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.argv[2];
const out = process.argv[3];
if (!url || !out || !/^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(url)) throw Error("An isolated loopback URL and evidence directory are required");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: `${out}/frames`, size: { width: 390, height: 844 } } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const receipt = [];
const check = (name, passed, details) => { receipt.push({ name, passed, details }); if (!passed) throw Error(name); };
const run = cmd => page.evaluate(cmd => window.__DASH_DEBUG__.run(cmd), cmd);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
try {
  await page.goto(`${url}?debug=1`, { timeout: 180000 });
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 180000 });
  await page.evaluate(() => window.__DASH_DEBUG__.scenario("chat-streaming"));
  await page.evaluate(() => document.fonts.ready);
  await run({ action: "replyFixture", reset: true, seq: 1 });
  await run({ action: "replyFixture", seq: 2, part: { kind: "tool_start", callId: "polish", name: "terminal", summary: "git status --short", args: '{"command":"git status --short"}' } });
  await run({ action: "replyFixture", seq: 3, part: { kind: "tool_output", callId: "polish", text: "First output\nSecond output\nThird output\nLatest output", truncated: false } });
  const disclosure = page.getByRole("button", { name: "Tool calls", exact: true });
  await disclosure.waitFor();
  check("compact defaults closed", await disclosure.getAttribute("aria-expanded") === "false");
  check("44px disclosure target", (await disclosure.boundingBox()).height >= 44);
  check("descriptive command", await page.getByText("git status --short", { exact: true }).count() > 0);
  await shot("compact-390");
  await disclosure.click();
  const call = page.getByTestId("tree-row-detail-fixture-turn:call:polish");
  await call.click();
  await disclosure.click(); await disclosure.click();
  check("inner tool disclosure retained", await call.getAttribute("aria-expanded") === "true");
  await run({ action: "replyFixture", seq: 4, part: { kind: "tool_output", callId: "polish", text: "\nStill streaming", truncated: false } });
  check("expanded choice survives stream", await disclosure.getAttribute("aria-expanded") === "true");
  await shot("expanded-390");
  await disclosure.click();
  await run({ action: "replyFixture", seq: 5, part: { kind: "tool_finish", callId: "polish", status: "error", durationMs: 420 } });
  await page.getByText("1 tool · 1 failed", { exact: true }).waitFor();
  check("failure remains visible when folded", await page.getByText("1 tool · 1 failed", { exact: true }).count() === 1);
  await shot("tool-failed-390");
  await run({ action: "replyFixture", seq: 6, part: { kind: "tool_output", callId: "polish", text: "x".repeat(1000000) + "\nTail one\nTail two\nTAIL_SENTINEL", truncated: true } });
  await page.getByText("Tail one\nTail two\nTAIL_SENTINEL", { exact: true }).waitFor();
  check("megabyte output has bounded rendered preview", await page.getByText("Tail one\nTail two\nTAIL_SENTINEL", { exact: true }).evaluate(el => el.textContent.length) < 500);
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Preserve this draft");
  await message.focus();
  const send = page.getByRole("button", { name: "Queue", exact: true });
  await send.focus();
  await page.keyboard.down("Space"); await page.waitForTimeout(80); await shot("keyboard-pressed-390");
  await page.keyboard.up("Space");
  // Sending the fixture may park a local queue; reset to keep later outcomes isolated.
  await run({ action: "replyFixture", reset: true, seq: 6 });
  await message.fill("Draft survives connection changes"); await message.focus();
  await run({ action: "setConnection", status: "offline" });
  check("draft retained offline", await message.inputValue() === "Draft survives connection changes");
  check("focused input retained", await message.evaluate(el => el === document.activeElement));
  await page.getByText("Waiting for connection", { exact: true }).waitFor();
  check("offline waiting label", await page.getByText("Waiting for connection", { exact: true }).count() === 1);
  await shot("offline-390");
  await run({ action: "replyFixture", outcome: "error", seq: 7 });
  await page.getByRole("alert").filter({ hasText: "Reply failed" }).waitFor();
  check("error has accessible alert", await page.getByRole("alert").filter({ hasText: "Reply failed" }).count() === 1);
  await shot("reply-error-390");
  await run({ action: "replyFixture", outcome: "interrupted", seq: 8 });
  await page.getByText("Reply interrupted", { exact: true }).waitFor();
  check("interruption distinct from failure", await page.getByText("Reply interrupted", { exact: true }).count() === 1);
  await shot("reply-interrupted-390");
  for (const width of [390, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('[role="alert"],textarea,[aria-label="Tool calls"]')].filter(el => { const b = el.getBoundingClientRect(); return b.width && (b.left < -1 || b.right > innerWidth + 1); }).map(el => el.getAttribute("aria-label") || el.textContent));
    check(`changed controls fit ${width}px`, overflow.length === 0, overflow);
    await shot(`outcome-${width}`);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("reduced-motion-390");
  check("no renderer exceptions", errors.length === 0, errors);
} finally {
  await writeFile(`${out}/receipt.json`, JSON.stringify({ source: "local debug fixtures, not a model turn", assertions: receipt, errors }, null, 2));
  await context.close(); await browser.close();
}
console.log(JSON.stringify({ passed: receipt.length, errors }));
