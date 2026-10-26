import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve("docs/flow/wp1-3-evidence");
mkdirSync(out, { recursive: true });
const build = await Bun.build({
  entrypoints: ["./scripts/fixtures/flow-pen-web.ts"], target: "browser",
  external: ["@shopify/react-native-skia", "expo-secure-store", "@react-native-async-storage/async-storage", "react-native"],
  plugins: [{ name: "no-native-auth-in-web-proxy", setup(build) {
    build.onLoad({ filter: /\/identity-secret\.ts$/ }, () => ({ contents: 'export async function loadIdentitySecret() { throw new Error("Native auth is outside this web proxy"); }', loader: "ts" }));
  } }],
  define: { "process.env.NODE_ENV": '"production"', "process.env.EXPO_PUBLIC_DASH_BUILD_SHA": "undefined", "process.env.EXPO_PUBLIC_DASH_BUILD_TIME": "undefined", "process.env.EXPO_PUBLIC_DASH_TURBO": '"1"', "process.env.EXPO_PUBLIC_DASH_FLOW_MODE": '"1"' },
});
if (!build.success || !build.outputs[0]) throw new Error(String(build.logs));
const script = await build.outputs[0].text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  return new URL(request.url).pathname === "/fixture.js"
    ? new Response(script, { headers: { "content-type": "text/javascript" } })
    : new Response('<!doctype html><title>Closed pen loop web proxy</title><script type="module" src="/fixture.js"></script>', { headers: { "content-type": "text/html" } });
} });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.getByRole("button", { name: "Close stylus loop" }).click();
  await page.waitForFunction(() => Reflect.get(window, "flowResult") !== undefined);
  const result: unknown = await page.evaluate(() => Reflect.get(window, "flowResult"));
  const raw = JSON.stringify(result);
  await Bun.write(resolve(out, "pen-web.json"), JSON.stringify({ kind: "web-proxy-not-native", result, errors }, null, 2) + "\n");
  const check = await page.evaluate(() => {
    const result = Reflect.get(window, "flowResult");
    const up = result.trace.marks.find((mark: { stage: string }) => mark.stage === "ink.up");
    const paint = result.trace.marks.find((mark: { stage: string }) => mark.stage === "chip.paint");
    return { ms: paint?.at - up?.at, persisted: result.restored.strokes.length === 1, inactive: !result.active, ready: result.draft.attachments[0]?.state === "ready", textPreserved: result.draft.text.startsWith("Existing typed question") };
  });
  if (errors.length || !check.persisted || !check.inactive || !check.ready || !check.textPreserved || !(check.ms >= 0 && check.ms <= 300)) throw new Error(JSON.stringify({ check, errors, raw }));
  console.log(JSON.stringify({ kind: "web-proxy-not-native", ...check, errors }));
} finally {
  await browser.close(); server.stop(true);
}
