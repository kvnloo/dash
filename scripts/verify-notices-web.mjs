// Host-only fixture proof: no phone, no bridge/agent traffic, no native scheduling.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".notice-evidence/web");
const out = resolve(process.argv[3] ?? ".notice-evidence");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const file = resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { const target = file === root ? resolve(root, "index.html") : file; const body = await readFile(target); res.writeHead(200, { "Content-Type": mime[extname(target)] ?? "application/octet-stream" }).end(body); }
  catch { try { res.writeHead(200, { "Content-Type": "text/html" }).end(await readFile(resolve(root, "index.html"))); } catch { res.writeHead(404).end(); } }
});
await new Promise(ok => server.listen(0, "127.0.0.1", ok));
let browser;
const pageErrors = [], captures = [];
try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("notice-fixture")) return;
    sessionStorage.setItem("notice-fixture", "1");
    localStorage.setItem("dash.notices.v1", JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ type: "notice", id: `fixture-${i}`, title: i ? `Fixture report ${i}` : "Build ready · all checks passed", body: i ? "Fixture report body. ".repeat(30).slice(0, 600) : "Fixture only: agent reports stay separate from approvals. Background delivery uses your notification setting.", ...(i === 0 ? { url: "dash://chat/fixture-chat" } : {}) }))));
  });
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("Missing owned HTTP address");
  await page.goto(`http://127.0.0.1:${address.port}/?debug=1`);
  await page.waitForFunction(() => Boolean(window.__DASH_DEBUG__), { timeout: 60000 });
  await page.evaluate(() => window.__DASH_DEBUG__.scenario("settings"));
  await page.getByRole("button", { name: "Notices · Agent reports", exact: true }).click();
  await page.getByText("Build ready · all checks passed", { exact: true }).waitFor();
  for (const width of [390, 800, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: resolve(out, `notices-${width}.png`) });
    const rendered = await page.getByText("No approval required", { exact: false }).isVisible();
    if (!rendered) throw new Error("Notice list not visible");
    const overflow = await page.evaluate(() => [...document.querySelectorAll('[dir="auto"]')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }).map(el => el.textContent?.slice(0, 100)));
    if (overflow.length) throw new Error(`Text overflow: ${JSON.stringify(overflow)}`);
    captures.push({ width, titleVisible: true, textOverflow: overflow });
  }
  if (await page.getByText("Fixture report 49", { exact: true }).count() !== 1) throw new Error("Last retained report missing or duplicated");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__DASH_DEBUG__));
  await page.evaluate(() => window.__DASH_DEBUG__.run({ action: "navigate", screen: "Notices" }));
  await page.getByText("Build ready · all checks passed", { exact: true }).waitFor();
  if (pageErrors.length) throw new Error(JSON.stringify(pageErrors));
  await writeFile(resolve(out, "web-smoke.json"), JSON.stringify({ fixture: true, nativeDeliveryVerified: false, captures, pageErrors, persistedAfterReload: true }, null, 2));
  console.log("Notice fixture render and Settings navigation passed at 390/800/1280; reload persistence passed.");
} finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
