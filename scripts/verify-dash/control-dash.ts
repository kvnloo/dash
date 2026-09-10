#!/usr/bin/env bun
/**
 * Drive Dash the way a user (and a later agent) can prove it.
 *
 *   bun scripts/verify-dash/control-dash.ts doctor
 *   bun scripts/verify-dash/control-dash.ts pair
 *   bun scripts/verify-dash/control-dash.ts roster
 *   bun scripts/verify-dash/control-dash.ts test
 *   bun scripts/verify-dash/control-dash.ts screenshot --scenario main-chats
 *
 * Never claims a pair code. Never starts a second bridge. Never binds Metro 8097.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BRIDGE = (process.env.DASH_BRIDGE ?? "http://127.0.0.1:4747").replace(/\/$/, "");
const METRO = (process.env.DASH_METRO ?? "http://127.0.0.1:8097").replace(/\/$/, "");
const DEBUG_WEB = (process.env.DASH_DEBUG_WEB ?? "http://127.0.0.1:8099").replace(/\/$/, "");
const EVIDENCE = process.env.DASH_EVIDENCE ?? join(ROOT, "artifacts/verify-dash");

function token(): string {
  return readFileSync(join(homedir(), ".dash/token"), "utf8").trim();
}

function evidencePath(name: string): string {
  mkdirSync(EVIDENCE, { recursive: true });
  return join(EVIDENCE, name);
}

async function get(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  return { status: res.status, body: await res.text() };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function doctor(): Promise<number> {
  const report: Record<string, unknown> = { bridge: BRIDGE, metroUrl: METRO, debugWeb: DEBUG_WEB };
  try {
    const root = await get(`${BRIDGE}/`);
    const json = parseJson(root.body);
    report.bridgeHttp = { status: root.status, ok: isRecord(json) && json.ok === true, host: isRecord(json) ? json.host : null };
  } catch (error) {
    report.bridgeHttp = { error: String(error) };
  }
  try {
    const pair = await get(`${BRIDGE}/pair`);
    const json = parseJson(pair.body);
    report.pair = {
      status: pair.status,
      codeLen: isRecord(json) && typeof json.code === "string" ? json.code.length : 0,
    };
  } catch (error) {
    report.pair = { error: String(error) };
  }
  try {
    const roster = await get(`${BRIDGE}/roster?token=${encodeURIComponent(token())}`);
    const json = parseJson(roster.body);
    report.roster = {
      status: roster.status,
      hosts: isRecord(json) && Array.isArray(json.hosts) ? json.hosts.length : 0,
    };
  } catch (error) {
    report.roster = { error: String(error) };
  }
  try {
    const metro = await get(`${METRO}/status`);
    report.metro = { status: metro.status };
  } catch (error) {
    report.metro = { error: String(error) };
  }
  const path = evidencePath("doctor.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  const bridgeOk = isRecord(report.bridgeHttp) && report.bridgeHttp.ok === true;
  const pairOk = isRecord(report.pair) && report.pair.codeLen === 6;
  console.log(JSON.stringify({ evidence: path, ...report }, null, 2));
  return bridgeOk && pairOk ? 0 : 1;
}

async function pair(): Promise<number> {
  const res = await get(`${BRIDGE}/pair`);
  const json = parseJson(res.body);
  if (res.status !== 200 || !isRecord(json) || typeof json.code !== "string" || json.code.length !== 6) {
    console.error("pair endpoint did not return a 6-char code");
    return 1;
  }
  const proof = {
    status: res.status,
    host: json.host,
    address: json.address,
    codeLength: json.code.length,
    hasLink: typeof json.link === "string",
  };
  const path = evidencePath("pair.json");
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ evidence: path, ...proof }, null, 2));
  return 0;
}

async function roster(): Promise<number> {
  const res = await get(`${BRIDGE}/roster?token=${encodeURIComponent(token())}`);
  const json = parseJson(res.body);
  if (res.status !== 200 || !isRecord(json) || !Array.isArray(json.hosts)) {
    console.error(`roster failed: ${res.status} ${res.body.slice(0, 200)}`);
    return 1;
  }
  const hosts = json.hosts as Array<{ id?: unknown; name?: unknown }>;
  const proof = {
    status: res.status,
    host: json.host,
    count: hosts.length,
    names: hosts.map((h) => h.name).filter((n) => typeof n === "string"),
  };
  const path = evidencePath("roster.json");
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ evidence: path, ...proof }, null, 2));
  return 0;
}

async function tests(): Promise<number> {
  const nav = Bun.spawnSync(["bun", "test", "app/src/components/golden-nav.test.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const roster = Bun.spawnSync(["bun", "test", "src/roster.test.ts"], { cwd: join(ROOT, "bridge"), stdout: "pipe", stderr: "pipe" });
  const proof = {
    nav: { code: nav.exitCode, stdout: nav.stdout.toString(), stderr: nav.stderr.toString() },
    roster: { code: roster.exitCode, stdout: roster.stdout.toString(), stderr: roster.stderr.toString() },
  };
  const path = evidencePath("tests.json");
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ evidence: path, nav: nav.exitCode, roster: roster.exitCode }, null, 2));
  return nav.exitCode === 0 && roster.exitCode === 0 ? 0 : 1;
}

async function screenshot(scenario: string): Promise<number> {
  const out = evidencePath("shots");
  const result = Bun.spawnSync(
    ["bun", join(ROOT, "scripts/debug-screenshots.mjs"), "--port", "8099", "--out", out],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  writeFileSync(
    evidencePath("screenshot.json"),
    `${JSON.stringify({ scenario, code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }, null, 2)}\n`,
  );
  console.log(result.stdout.toString());
  if (result.stderr.length) console.error(result.stderr.toString());
  return result.exitCode ?? 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const args = process.argv.slice(2);
const cmd = args[0];
const scenario = args.find((a, i) => args[i - 1] === "--scenario") ?? "main-chats";

const code = await (async () => {
  switch (cmd) {
    case "doctor":
      return doctor();
    case "pair":
      return pair();
    case "roster":
      return roster();
    case "test":
      return tests();
    case "screenshot":
      return screenshot(scenario);
    default:
      console.error("usage: control-dash.ts doctor|pair|roster|test|screenshot [--scenario id]");
      return 1;
  }
})();

process.exit(code);
