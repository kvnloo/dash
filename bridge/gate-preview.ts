#!/usr/bin/env bun
// Owned production web preview. Never starts Metro or touches an existing bridge.
import { resolve, sep } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
const root = resolve(process.env.DASH_WEB_DIR ?? "");
if (!process.env.DASH_WEB_DIR || !await Bun.file(resolve(root, "index.html")).exists()) throw new Error("DASH_WEB_DIR must point to an exported production app");
const host = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" }).trim().split("\n")[0];
if (!host) throw new Error("Tailnet unavailable");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const web = Bun.serve({ hostname: host, port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/build.json") return Response.json({ sha, feature: "approvals-gate", exported: true }, { headers: { "Cache-Control": "no-store" } });
  const path = resolve(root, "." + decodeURIComponent(url.pathname));
  if (path !== root && !path.startsWith(root + sep)) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(path);
  const response = await file.exists() && path !== root ? new Response(file) : new Response(Bun.file(resolve(root, "index.html")));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
} });
const origin = `http://${host}:${web.port}`;
const credentialDir = process.env.DASH_CREDENTIAL_DIR ?? resolve(homedir(), ".dash");
const bridge = Bun.spawn([process.execPath, resolve(import.meta.dir, "index.ts")], {
  env: { ...process.env, DASH_HOST: host, DASH_PORT: "0", DASH_ALLOWED_ORIGINS: origin, DASH_GATE_ENABLED: "1", DASH_GATE_LIVE: "0", DASH_GATE_OWNER_DECISIONS: process.env.DASH_GATE_OWNER_DECISIONS ?? "0", DASH_CREDENTIAL_DIR: credentialDir, DASH_STT_MODEL: "/nonexistent/approval-preview-no-stt" },
  stdout: "ignore", stderr: "pipe",
});
let bridgePort = 0;
const reading = (async () => { for await (const chunk of bridge.stderr) {
  const m = new TextDecoder().decode(chunk).match(/dash bridge\s+ws:\/\/[\d.]+:(\d+)/);
  if (m) bridgePort = Number(m[1]);
} })();
for (let n=0;!bridgePort && n<200;n++) { if (bridge.exitCode !== null) throw new Error("Owned bridge exited"); await Bun.sleep(25); }
if (!bridgePort) { bridge.kill("SIGTERM"); throw new Error("Owned bridge startup timed out"); }
const manifest = { web_url: origin, bridge_address: `${host}:${bridgePort}`, build_sha: sha, web_pid: process.pid, bridge_pid: bridge.pid, credential_dir: credentialDir, store: process.env.DASH_GATE_DIR ?? "canonical", owner_decisions: process.env.DASH_GATE_OWNER_DECISIONS === "1", live_posting: false };
if (process.env.DASH_PREVIEW_MANIFEST) await Bun.write(process.env.DASH_PREVIEW_MANIFEST, JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
async function stop() { web.stop(true); bridge.kill("SIGTERM"); await bridge.exited; await reading; process.exit(0); }
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
