#!/usr/bin/env node
/**
 * Capture Dash UI screenshots via Expo web + debug API.
 * Usage: node scripts/debug-screenshots.mjs [--port 8099] [--out screenshots/debug]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appDir = path.join(root, "app");

const args = process.argv.slice(2);
const port = Number(args.find((a, i) => args[i - 1] === "--port") ?? "8099");
const outDir = path.resolve(root, args.find((a, i) => args[i - 1] === "--out") ?? "screenshots/debug");

const SCENARIOS = [
  "main",
  "main-bots",
  "main-chats",
  "main-products",
  "chat-omp",
  "chat-streaming",
  "chat-picker",
  "pair",
  "settings",
  "orchestra-dash",
];

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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  const manifest = [];

  for (const scenario of SCENARIOS) {
    const page = await context.newPage();
    console.error(`→ ${scenario}`);
    await page.goto(`${baseUrl}?debug=1`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForFunction(() => typeof window.__DASH_DEBUG__?.scenario === "function", undefined, {
      timeout: 90_000,
    });
    await page.evaluate(async (id) => {
      await window.__DASH_DEBUG__.scenario(id);
    }, scenario);
    await page.waitForTimeout(800);
    const file = path.join(outDir, `${scenario}.png`);
    await page.screenshot({ path: file, fullPage: false });
    manifest.push({ scenario, file });
    await page.close();
  }

  await browser.close();
  killExpo();

  console.log(JSON.stringify({ outDir, shots: manifest }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
