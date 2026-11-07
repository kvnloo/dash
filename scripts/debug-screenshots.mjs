#!/usr/bin/env node
/**
 * Capture Dash UI screenshots via Expo web + debug API.
 * Usage: node scripts/debug-screenshots.mjs [--port 8099] [--out screenshots/debug]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertLivingNight, exerciseLivingNight } from "./assert-living-night.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDir = path.join(root, "app");

const args = process.argv.slice(2);
const port = Number(args.find((a, i) => args[i - 1] === "--port") ?? "8099");
const outDir = path.resolve(root, args.find((a, i) => args[i - 1] === "--out") ?? "screenshots/debug");

const SCENARIOS = [
  "main-chats", "main-chats-search", "main-hosts", "main-orchestra",
  "chat", "chat-streaming", "pair", "settings", "voice", "approvals",
  "chat-picker", "orchestra-dash", "main", "main-products", "chat-omp", "chat-attachments",
];

async function sourceFingerprint() {
  async function walk(dir) {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat();
  }
  const files = [...await walk("app/src"), ...await walk("app/assets/orbs"), "app/App.tsx", "app/package.json", "app/bun.lock", "scripts/assert-living-night.mjs", "scripts/debug-screenshots.mjs"];
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(file).update("\0").update(await readFile(path.join(root, file))).update("\0");
  return hash.digest("hex");
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startExpo() {
  return spawn("bunx", ["expo", "start", "--web", "--port", String(port), "--non-interactive"], {
    cwd: appDir,
    env: {
      ...process.env,
      EXPO_PUBLIC_DEBUG: "1",
      EXPO_PUBLIC_DEBUG_AUTONAV: "0",
      CI: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Playwright is a laptop screenshot tool, not a phone-app dependency.
  const playwrightRoot = path.join(root, "node_modules", "playwright");
  let playwright;
  try {
    playwright = await import(path.join(playwrightRoot, "index.mjs"));
  } catch {
    try {
      playwright = await import("playwright");
    } catch {
      console.error(
        "Install playwright at the repo root (not the phone app): bun add -d playwright && bunx playwright install chromium",
      );
      process.exit(1);
    }
  }

  const sourceHash = await sourceFingerprint();
  const expo = startExpo();
  expo.stdout?.on("data", (d) => process.stderr.write(d));
  expo.stderr?.on("data", (d) => process.stderr.write(d));

  const killExpo = () => {
    if (!expo.killed) expo.kill("SIGTERM");
  };
  process.on("exit", killExpo);
  process.on("SIGINT", () => {
    killExpo();
    process.exit(130);
  });

  const baseUrl = `http://localhost:${port}`;
  console.error(`Waiting for Expo web at ${baseUrl}…`);
  await waitForHttp(baseUrl);

  const browser = await playwright.chromium.launch({ headless: true });
  try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });

  const manifest = [];
  const geometry = [];
  const errors = [];

  for (const scenario of SCENARIOS) {
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(`${scenario}: ${e.message}`));
    console.error(`→ ${scenario}`);
    await page.goto(`${baseUrl}?debug=1`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForFunction(() => typeof window.__DASH_DEBUG__?.scenario === "function", undefined, {
      timeout: 90_000,
    });
    await page.evaluate(async (id) => {
      await window.__DASH_DEBUG__.scenario(id);
    }, scenario);
    await page.evaluate(() => document.fonts.ready);
    if (scenario === "main-chats-search") await page.getByRole("textbox", { name: "Message", exact: true }).focus();
    await page.waitForTimeout(800);
    geometry.push(await assertLivingNight(page, scenario));
    const file = path.join(outDir, `${scenario}.png`);
    await page.screenshot({ path: file, fullPage: false });
    manifest.push({ scenario, file });
    geometry.at(-1).journey = await exerciseLivingNight(page, scenario);
    await page.close();
  }

  if (sourceHash !== await sourceFingerprint()) throw new Error("UI source changed during capture; rerun proof");
  await writeFile(path.join(outDir, "geometry.json"), JSON.stringify({ sourceHash, geometry, errors }, null, 2));
  await browser.close();
  killExpo();

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ outDir, shots: manifest, assertions: "PASS", errors }, null, 2));
  } finally { await browser.close(); killExpo(); }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
