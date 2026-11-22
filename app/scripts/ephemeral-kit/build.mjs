#!/usr/bin/env node
// Vendors one card host page from a pinned kvnloo/ephemeral-ui checkout (main, src/ layout).
//   (cd <ephemeral-ui checkout> && npm ci)   # the kit's own tool pins: esbuild, linkedom
//   node app/scripts/ephemeral-kit/build.mjs --kit <ephemeral-ui checkout> [--check] [--main]
// Writes app/src/vendor/ephemeral-ui/{kit-html,kinds}.generated.ts. --check fails if they are stale.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { synthesize } from "./synthetic.mjs";

export const KIT_REV = "d5e4a5b42b480d5d187533b1fe3e48db386478b0";
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const outDir = join(appDir, "src/vendor/ephemeral-ui");
const args = process.argv.slice(2);
const kit = resolve(args[args.indexOf("--kit") + 1] || "");
const check = args.includes("--check");
// --main: also require the pin to be the checkout's origin/main (the kit's current release).
if (args.includes("--main")) {
  const main = execFileSync("git", ["-C", kit, "rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  if (main !== KIT_REV) throw new Error(`pinned ${KIT_REV}, kvnloo/ephemeral-ui main is ${main}: re-pin and rebuild`);
}
const kitHead = execFileSync("git", ["-C", kit, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (kitHead !== KIT_REV) throw new Error(`ephemeral-ui checkout is at ${kitHead}, pinned ${KIT_REV}`);
const dirty = execFileSync("git", ["-C", kit, "status", "--porcelain", "--", "src"], { encoding: "utf8" }).trim();
if (dirty) throw new Error(`ephemeral-ui checkout has local edits:\n${dirty}`);
const src = join(kit, "src");
// The kit's own tool pins (its package.json), not Dash dependencies.
const kitRequire = createRequire(join(kit, "package.json"));
const { build, transform } = await import(process.env.ESBUILD || pathToFileURL(kitRequire.resolve("esbuild")).href);
const bundle = async (entry, options) => (await build({
  entryPoints: [join(here, entry)], bundle: true, write: false, minify: true, target: "es2020",
  alias: { "@eui": join(src, "js") }, legalComments: "none", logLevel: "error", ...options,
})).outputFiles[0].text;

// The kind registry is the kit's: evaluate registry.js against a DOM shim and read what it exports.
async function registry() {
  const { parseHTML } = await import(pathToFileURL(kitRequire.resolve("linkedom")).href);
  const { window } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  for (const k of ["document", "HTMLElement", "Node", "CustomEvent", "Event", "getComputedStyle"]) globalThis[k] ??= window[k];
  Object.assign(globalThis, { window: globalThis, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => setTimeout(f, 16) });
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
  const dir = mkdtempSync(join(tmpdir(), "eui-registry-"));
  try {
    const file = join(dir, "registry.mjs");
    writeFileSync(file, await bundle("registry.js", { format: "esm", minify: false, platform: "neutral" }));
    return await import(pathToFileURL(file).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const reg = await registry();

const js = await bundle("host-entry.js", { format: "iife" });
// Every stylesheet a card kind reads (the site-only flow and reel sheets are left out).
const CSS = ["styles.css", "studio.css", "trace.css", "intent.css", "stats.css", "ops.css", "fleet.css", "fleet-hosts.css", "fleet-pm.css", "fleet-factory.css", "intel.css", "dock.css", "cua.css", "gev.css"];
const css = (await transform(CSS.map(f => readFileSync(join(src, f), "utf8")).join("\n"), { loader: "css", minify: true })).code;
// Data is split so a card page carries only what its kind reads (trace, intent and ops fixtures are large).
const DATA = { apps: "apps.json", themes: "themes.json", trace: "trace-fixture.json", intent: "intent-snapshot.json", ops: "ops-fixture.json" };
// JSON: "<" only occurs inside strings, so < is exact. JS/CSS must simply never close the element.
const safeJSON = s => s.replace(/</g, "\\u003c");
const safe = s => { if (/<\/(script|style)|<!--/i.test(s)) throw new Error("kit source would close its element"); return s; };
// The kit's trace, intent and ops fixtures are sanitized real measurements; Dash vendors synthetic data in their shape.
const SYNTHETIC = new Set(["trace", "intent", "ops"]);
const read = (key, f) => { const json = JSON.parse(readFileSync(join(src, "data", f), "utf8")); return SYNTHETIC.has(key) ? synthesize(key, json) : json; };
const data = Object.fromEntries(Object.entries(DATA).map(([key, f]) => [key, safeJSON(JSON.stringify(f) + ":" + JSON.stringify(read(key, f)))]));
// Host-only shims: the kit fetches data/*.json and persists its theme; here both stay in the page.
const shim = `window.__EUI_SPEC=/*EUI_SPEC*/null;(function(){var D=JSON.parse(document.getElementById("eui-data").textContent);window.fetch=function(u){var k=String(u).split("/").pop().split("?")[0];return D[k]?Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(JSON.parse(JSON.stringify(D[k])))}}):Promise.resolve({ok:false,status:404,json:function(){return Promise.reject(new Error("offline"))}})};var m={};var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]}};try{window.localStorage.getItem("x")}catch(e){Object.defineProperty(window,"localStorage",{value:s,configurable:true})}})();`;
const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const head = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${safe(css)}html,body{margin:0;padding:0;background:transparent}#eui-root{padding:2px}#eui-root>.eu-card{margin:0;max-width:none}</style></head><body><div id="eui-root"></div><script type="application/json" id="eui-data">{`;
const tail = `}</script><script>${shim}</script><script>${safe(js)}</script></body></html>`;
const parts = { head, tail, data };

const kinds = Object.keys(reg.KINDS);
const schema = JSON.parse(readFileSync(join(src, "schema/card.v0.json"), "utf8"));
const unexported = schema.properties.kind.enum.filter(k => !kinds.includes(k));
if (unexported.length) throw new Error(`card.v0 kinds the kit does not export: ${unexported.join(", ")}`);
const apps = JSON.parse(readFileSync(join(src, "data/apps.json"), "utf8")).apps;
const appIds = new Set(apps.map(a => a.id));
const appsByKind = Object.fromEntries(kinds.map(k => {
  const listed = apps.filter(a => (a.kinds || []).includes(k)).map(a => a.id);
  return [k, listed.length ? listed : reg.DEFAULT_APPS[k] ? [reg.DEFAULT_APPS[k]] : []];
}));
const missing = kinds.filter(k => !appsByKind[k].length);
if (missing.length) throw new Error(`kinds without a catalog or default app: ${missing.join(", ")}`);
const unknownApps = [...new Set(Object.values(appsByKind).flat())].filter(id => !appIds.has(id) && !Object.hasOwn(reg.HOST_APP_NAMES, id));
if (unknownApps.length) throw new Error(`default apps neither in apps.json nor HOST_APP_NAMES: ${unknownApps.join(", ")}`);
const dataByKind = Object.fromEntries(Object.values(reg.GROUPS).flatMap(([group, extra]) => extra ? Object.keys(group).map(k => [k, extra]) : []));
const sha = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const banner = `// GENERATED by app/scripts/ephemeral-kit/build.mjs from kvnloo/ephemeral-ui@${KIT_REV}. Do not edit.\n`;
const files = {
  "kinds.generated.ts": `${banner}export const EPHEMERAL_KIT_REV = ${JSON.stringify(KIT_REV)};\n/** Every card kind the kit exports, in its main.js KINDS order, then the standalone dock, cua and gev kinds. */\nexport const EPHEMERAL_KINDS = ${JSON.stringify(kinds)} as const;\nexport type EphemeralKind = (typeof EPHEMERAL_KINDS)[number];\n/** Catalog app ids that list each kind (apps.json), else the kit's default app; the first is the default. */\nexport const EPHEMERAL_APPS_BY_KIND: Record<EphemeralKind, readonly string[]> = ${JSON.stringify(appsByKind)};\n/** The one kit fixture a kind reads beyond apps and themes. */\nexport const EPHEMERAL_DATA_BY_KIND: Partial<Record<EphemeralKind, "trace" | "intent" | "ops">> = ${JSON.stringify(dataByKind)};\n`,
  "kit-html.generated.ts": `${banner}export const EPHEMERAL_KIT_SHA256 = ${JSON.stringify(sha)};\n/** head + "," joined data entries + tail is one card page; see lib/ephemeral-card.ts. */\nexport const EPHEMERAL_KIT_PARTS: { head: string; tail: string; data: Record<"apps" | "themes" | "trace" | "intent" | "ops", string> } = ${JSON.stringify(parts)};\n`,
};
mkdirSync(outDir, { recursive: true });
let stale = [];
for (const [name, text] of Object.entries(files)) {
  const path = join(outDir, name);
  let old = null;
  try { old = readFileSync(path, "utf8"); } catch { /* new */ }
  if (old !== text) { stale.push(name); if (!check) writeFileSync(path, text); }
}
console.log(JSON.stringify({ rev: KIT_REV, kinds: kinds.length, bytes: Object.fromEntries(Object.entries({ head, tail, ...data }).map(([k, v]) => [k, Buffer.byteLength(v)])), sha256: sha, stale, check }));
if (check && stale.length) process.exit(1);
