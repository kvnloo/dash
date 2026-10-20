import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { orbHtml } from "../app/src/components/orb-html";
// Actual static captures of the source catalog, not letter-avatar substitutes.
const browser = await chromium.launch({ headless: true });
try {
  await mkdir(new URL("../app/assets/orbs/", import.meta.url), { recursive: true });
  const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  for (const preset of ["chatgpt", "gemini", "siri", "alexa", "elevenlabs", "grok"]) {
    for (const mono of [false, true]) {
    await page.setContent(orbHtml(preset, "idle", mono));
    await page.waitForTimeout(400);
    await page.screenshot({ path: new URL(`../app/assets/orbs/${preset}${mono ? "-mono" : ""}.png`, import.meta.url).pathname, omitBackground: true });
    console.log(`Captured ${preset}, ${mono ? "mono" : "night"}, idle, 256×256`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
} finally { await browser.close(); }
