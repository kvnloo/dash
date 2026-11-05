#!/usr/bin/env node
// Vendors one card host page from a pinned kvnloo/ephemeral-ui checkout.
//   node app/scripts/ephemeral-kit/build.mjs --kit <ephemeral-ui checkout> [--check]
// Writes app/src/vendor/ephemeral-ui/{kit-html,kinds}.generated.ts. --check fails if they are stale.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { synthesize } from "./synthetic.mjs";

export const KIT_REV = "63e06b29ffb0d7c5b9d482abebc0312335897321";
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const outDir = join(appDir, "src/vendor/ephemeral-ui");
const args = process.argv.slice(2);
const kit = resolve(args[args.indexOf("--kit") + 1] || "");
const check = args.includes("--check");
const kitHead = execFileSync("git", ["-C", kit, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (kitHead !== KIT_REV) throw new Error(`ephemeral-ui checkout is at ${kitHead}, pinned ${KIT_REV}`);
const dirty = execFileSync("git", ["-C", kit, "status", "--porcelain", "--", "js", "data", "schema", "*.css"], { encoding: "utf8" }).trim();
if (dirty) throw new Error(`ephemeral-ui checkout has local edits:\n${dirty}`);

const { build, transform } = await import(process.env.ESBUILD || "esbuild");
const js = (await build({
  entryPoints: [join(here, "host-entry.js")], bundle: true, write: false, format: "iife", minify: true,
  target: "es2020", alias: { "@eui": join(kit, "js") }, legalComments: "none", logLevel: "error",
})).outputFiles[0].text;
const CSS = ["styles.css", "studio.css", "trace.css", "intent.css", "stats.css", "ops.css", "infra.css"];
const css = (await transform(CSS.map(f => readFileSync(join(kit, f), "utf8")).join("\n"), { loader: "css", minify: true })).code;
// Data is split so a card page carries only what its kind reads (trace and intent fixtures are large).
const DATA = { apps: "apps.json", themes: "themes.json", trace: "trace-fixture.json", intent: "intent-snapshot.json" };
// JSON: "<" only occurs inside strings, so \u003c is exact. JS/CSS must simply never close the element.
const safeJSON = s => s.replace(/</g, "\\u003c");
const safe = s => { if (/<\/(script|style)|<!--/i.test(s)) throw new Error("kit source would close its element"); return s; };
// The kit's trace and intent fixtures are sanitized real measurements; Dash vendors synthetic data in their shape.
const SYNTHETIC = new Set(["trace", "intent"]);
const read = (key, f) => { const json = JSON.parse(readFileSync(join(kit, "data", f), "utf8")); return SYNTHETIC.has(key) ? synthesize(key, json) : json; };
const data = Object.fromEntries(Object.entries(DATA).map(([key, f]) => [key, safeJSON(JSON.stringify(f) + ":" + JSON.stringify(read(key, f)))]));
// Host-only shims: the kit fetches data/*.json and persists its theme; here both stay in the page.
const shim = `window.__EUI_SPEC=/*EUI_SPEC*/null;(function(){var D=JSON.parse(document.getElementById("eui-data").textContent);window.fetch=function(u){var k=String(u).split("/").pop().split("?")[0];return D[k]?Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(JSON.parse(JSON.stringify(D[k])))}}):Promise.resolve({ok:false,status:404,json:function(){return Promise.reject(new Error("offline"))}})};var m={};var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]}};try{window.localStorage.getItem("x")}catch(e){Object.defineProperty(window,"localStorage",{value:s,configurable:true})}})();`;
const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const head = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${safe(css)}html,body{margin:0;padding:0;background:transparent}#eui-root{padding:2px}#eui-root>.eu-card{margin:0;max-width:none}</style></head><body><div id="eui-root"></div><script type="application/json" id="eui-data">{`;
const tail = `}</script><script>${shim}</script><script>${safe(js)}</script></body></html>`;
const parts = { head, tail, data };
const schema = JSON.parse(readFileSync(join(kit, "schema/card.v0.json"), "utf8"));
const kinds = schema.properties.kind.enum;
const apps = JSON.parse(readFileSync(join(kit, "data/apps.json"), "utf8")).apps;
const appsByKind = Object.fromEntries(kinds.map(k => [k, apps.filter(a => (a.kinds || []).includes(k)).map(a => a.id)]));
const missing = kinds.filter(k => !appsByKind[k].length);
if (missing.length) throw new Error(`kinds without a catalog app: ${missing.join(", ")}`);
const sha = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const banner = `// GENERATED by app/scripts/ephemeral-kit/build.mjs from kvnloo/ephemeral-ui@${KIT_REV}. Do not edit.\n`;
const files = {
  "kinds.generated.ts": `${banner}export const EPHEMERAL_KIT_REV = ${JSON.stringify(KIT_REV)};\nexport const EPHEMERAL_KINDS = ${JSON.stringify(kinds)} as const;\nexport type EphemeralKind = (typeof EPHEMERAL_KINDS)[number];\n/** Catalog app ids that list each kind (apps.json); the first is the default. */\nexport const EPHEMERAL_APPS_BY_KIND: Record<EphemeralKind, readonly string[]> = ${JSON.stringify(appsByKind)};\n`,
  "kit-html.generated.ts": `${banner}export const EPHEMERAL_KIT_SHA256 = ${JSON.stringify(sha)};\n/** head + "," joined data entries + tail is one card page; see lib/ephemeral-card.ts. */\nexport const EPHEMERAL_KIT_PARTS: { head: string; tail: string; data: Record<"apps" | "themes" | "trace" | "intent", string> } = ${JSON.stringify(parts)};\n`,
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
