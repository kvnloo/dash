#!/usr/bin/env bun
// Dash onboarding: one command turns a fresh clone into a running bridge (+ Metro) the phone can pair with.
// Run through scripts/onboard.sh, which first makes sure a recent Bun exists. `--help` lists the options.
//
// Steps: detect hardware and tools -> discover harnesses -> install locked deps -> write launchd (macOS)
// or systemd --user (Linux) services -> start them -> wait for health -> print a pairing code and links.
// Reversible: `--uninstall` stops and removes the services; ~/.dash credentials and node_modules stay.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir, totalmem } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { HARNESSES } from "../bridge/src/harnesses";
import { acpCommand } from "../bridge/src/acp/supervisor";

type Platform = "darwin" | "linux";
type Profile = "minimal" | "full";
type Step = "deps" | "app-deps" | "adapters" | "services" | "start";
const STEPS: readonly Step[] = ["deps", "app-deps", "adapters", "services", "start"];

const ROOT = resolve(import.meta.dir, "..");
const BRIDGE_DIR = join(ROOT, "bridge");
const APP_DIR = join(ROOT, "app");
const ADAPTERS_DIR = join(BRIDGE_DIR, "acp-adapters");
const HOME = process.env.HOME || homedir();
const GIB = 1024 ** 3;
/** Below this the full profile (Metro + app deps) is not chosen automatically. */
const FULL_PROFILE_MIN_GIB = 8;
const MACOS_TAILSCALE_APP = "/Applications/Tailscale.app/Contents/MacOS";

interface Options {
  action: "install" | "uninstall" | "pair" | "help";
  profile?: Profile;
  dryRun: boolean;
  platform: Platform;
  /** Unset: the existing service file's DASH_PORT, else 4747. */
  port?: number;
  metroPort: number;
  /** Unset: the existing service file's DASH_CWD, else the home folder. */
  cwd?: string;
  skip: Set<Step>;
  bridgeEnv: Record<string, string>;
  metroEnv: Record<string, string>;
}

const USAGE = `usage: scripts/onboard.sh [--minimal|--full] [options]
  --minimal            bridge only            --full   bridge + Metro + app deps + ACP adapters
                       (default: full with ${FULL_PROFILE_MIN_GIB} GiB RAM or more, otherwise minimal)
  --dry-run            print the plan and the service files; change nothing
  --pair               print a fresh pairing code and links for the installed bridge
  --uninstall          stop and remove the bridge and Metro services
  --port N             bridge port (default 4747)      --metro-port N   Metro port (default 8097)
  --cwd DIR            default working folder for agent turns (default: your home folder)
  --skip a,b           skip steps: ${STEPS.join(", ")}
  --env K=V            extra bridge environment (repeatable), e.g. --env DASH_TURN_TIMEOUT_MS=900000
  --metro-env K=V      extra Metro environment (repeatable)
                       Settings in an existing bridge/Metro service file (hand-written or from an earlier
                       run) are kept unless a flag overrides them; --uninstall first to start clean.
  --platform P         render services for darwin or linux (default: this machine)`;

function fail(message: string, code = 2): never {
  process.stderr.write(`onboard: ${message}\n`);
  process.exit(code);
}

function hostPlatform(): Platform {
  if (process.platform === "darwin" || process.platform === "linux") return process.platform;
  return fail(`unsupported platform ${process.platform}; Dash runs its bridge on macOS or Linux`);
}

function keyValue(raw: string | undefined, flag: string): [string, string] {
  const at = raw?.indexOf("=") ?? -1;
  if (!raw || at <= 0) return fail(`${flag} expects KEY=VALUE`);
  return [raw.slice(0, at), raw.slice(at + 1)];
}

function portArg(raw: string | undefined, flag: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(`${flag} expects a port number`);
  return port;
}

export function parseArgs(argv: readonly string[]): Options {
  const o: Options = { action: "install", dryRun: false, platform: hostPlatform(), metroPort: 8097, skip: new Set(), bridgeEnv: {}, metroEnv: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--minimal": o.profile = "minimal"; break;
      case "--full": o.profile = "full"; break;
      case "--dry-run": o.dryRun = true; break;
      case "--pair": o.action = "pair"; break;
      case "--uninstall": o.action = "uninstall"; break;
      case "-h": case "--help": o.action = "help"; break;
      case "--port": o.port = portArg(next(), arg); break;
      case "--metro-port": o.metroPort = portArg(next(), arg); break;
      case "--cwd": o.cwd = resolve(next() ?? fail("--cwd expects a folder")); break;
      case "--platform": {
        const value = next();
        if (value !== "darwin" && value !== "linux") fail("--platform expects darwin or linux");
        o.platform = value;
        break;
      }
      case "--skip":
        for (const step of (next() ?? "").split(",").filter(Boolean)) {
          const known = STEPS.find((s) => s === step);
          if (!known) fail(`unknown step ${step}; steps: ${STEPS.join(", ")}`);
          o.skip.add(known);
        }
        break;
      case "--env": { const [k, v] = keyValue(next(), arg); o.bridgeEnv[k] = v; break; }
      case "--metro-env": { const [k, v] = keyValue(next(), arg); o.metroEnv[k] = v; break; }
      default: fail(`unknown option ${arg}\n${USAGE}`);
    }
  }
  return o;
}

// ---------------------------------------------------------------- detection

interface Hardware {
  platform: Platform;
  arch: string;
  cpu: string;
  cores: number;
  memoryGiB: number;
  appleSilicon: boolean;
  gpu: string | null;
}

function run(argv: readonly string[], env?: Record<string, string>): string | null {
  const bin = Bun.which(argv[0] ?? "", env?.PATH ? { PATH: env.PATH } : undefined);
  if (!bin) return null;
  try {
    const result = Bun.spawnSync([bin, ...argv.slice(1)], { stdout: "pipe", stderr: "ignore", env: env ?? process.env });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

function detectHardware(platform: Platform): Hardware {
  const cores = cpus().length;
  const arch = process.arch;
  const appleSilicon = platform === "darwin" && arch === "arm64";
  const cpu = (platform === "darwin" ? run(["sysctl", "-n", "machdep.cpu.brand_string"]) : null) ?? cpus()[0]?.model ?? "unknown CPU";
  const nvidia = run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])?.split("\n")[0]?.trim();
  const gpu = nvidia || (appleSilicon ? "Apple GPU (unified memory)" : null);
  return { platform, arch, cpu, cores, memoryGiB: Math.round((totalmem() / GIB) * 10) / 10, appleSilicon, gpu };
}

/**
 * The PATH the services run with. launchd and systemd start services with a bare PATH, so harness
 * CLIs that work in this shell would vanish; capture this shell's PATH, plus Bun and, on macOS, the
 * Tailscale app's bundled CLI (the bridge finds its tailnet address with `tailscale ip -4`).
 */
function servicePath(platform: Platform, pathEnv = process.env.PATH ?? ""): string {
  const dirs = [dirname(process.execPath), ...pathEnv.split(delimiter)];
  if (platform === "darwin" && existsSync(join(MACOS_TAILSCALE_APP, "Tailscale"))) dirs.push(MACOS_TAILSCALE_APP);
  dirs.push("/usr/bin", "/bin", ...(platform === "darwin" ? ["/usr/sbin", "/sbin"] : []));
  return [...new Set(dirs.filter((d) => d.startsWith("/")))].join(delimiter);
}

interface HarnessReport {
  id: string;
  name: string;
  /** The bridge can start it: its ACP entrypoint is on the service PATH. */
  ready: boolean;
  cli: string | null;
  command: string | null;
  hint?: string;
}

/** Same rule as the bridge's hello (`acpCommand`), evaluated against the service PATH. */
export function discoverHarnesses(path: string): HarnessReport[] {
  const which = (bin: string) => Bun.which(bin, { PATH: path });
  return HARNESSES.map((h) => {
    const command = acpCommand(h.id, which);
    const cli = which(h.bin);
    const report: HarnessReport = { id: h.id, name: h.name, ready: command !== null, cli, command: command ? command.join(" ") : null };
    if (!report.ready) {
      if (cli && (h.id === "claude" || h.id === "codex")) report.hint = "CLI found; its ACP adapter installs with --full";
      else if (cli && h.id === "pi") report.hint = "CLI found; pi has no ACP entrypoint yet";
      else if (cli) report.hint = `CLI found but \`${h.bin}\` has no ACP mode the bridge can start`;
      else report.hint = `\`${h.bin}\` not on PATH`;
    }
    return report;
  });
}

function printHarnesses(list: readonly HarnessReport[]): void {
  const width = Math.max(...list.map((h) => h.name.length));
  console.log(`harnesses (${list.filter((h) => h.ready).length} of ${list.length} ready)`);
  for (const h of list) console.log(`  ${h.ready ? "ready    " : "missing  "}${h.name.padEnd(width)}  ${h.ready ? h.command : h.hint}`);
}

// ---------------------------------------------------------------- services

interface Service {
  id: "bridge" | "metro";
  /** launchd label or systemd unit name. */
  name: string;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  log: string;
}

function serviceFiles(platform: Platform): { dir: string; logs: string; name(id: Service["id"]): string } {
  if (platform === "darwin") {
    return { dir: join(HOME, "Library", "LaunchAgents"), logs: join(HOME, "Library", "Logs", "dash"), name: (id) => `dev.kvnloo.dash-${id}` };
  }
  return { dir: join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "systemd", "user"), logs: join(process.env.XDG_STATE_HOME || join(HOME, ".local", "state"), "dash", "logs"), name: (id) => `dash-${id}.service` };
}

function service(platform: Platform, id: Service["id"], args: string[], cwd: string, env: Record<string, string>): Service {
  const files = serviceFiles(platform);
  const name = files.name(id);
  // Sorted, so a rerun with the same settings writes the same file.
  const sorted = Object.fromEntries(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { id, name, file: join(files.dir, platform === "darwin" ? `${name}.plist` : name), args, cwd, env: sorted, log: join(files.logs, `${id}.log`) };
}

const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function renderLaunchd(s: Service): string {
  const str = (v: string) => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by scripts/onboard.sh. Rerun it to update; its uninstall option removes this file. (No double hyphen: XML comments forbid it.) -->
<plist version="1.0">
<dict>
  <key>Label</key>${str(s.name)}
  <key>ProgramArguments</key>
  <array>
${s.args.map((a) => `    ${str(a)}`).join("\n")}
  </array>
  <key>WorkingDirectory</key>${str(s.cwd)}
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(s.env).map(([k, v]) => `    <key>${xml(k)}</key>${str(v)}`).join("\n")}
  </dict>
  <key>StandardInPath</key><string>/dev/null</string>
  <key>StandardOutPath</key>${str(s.log)}
  <key>StandardErrorPath</key>${str(s.log)}
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
}

/** systemd quoting: double-quoted words, backslash escapes, `%` doubled (specifier escape). */
const unitWord = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;

export function renderSystemd(s: Service): string {
  return `# Written by scripts/onboard.sh; rerun it to update, or scripts/onboard.sh --uninstall to remove.
[Unit]
Description=Dash ${s.id === "bridge" ? "bridge (phone <-> local coding agents)" : "Metro (serves the Dash app to the phone)"}
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${s.cwd}
${Object.entries(s.env).map(([k, v]) => `Environment=${unitWord(`${k}=${v}`)}`).join("\n")}
ExecStart=${s.args.map(unitWord).join(" ")}
StandardInput=null
StandardOutput=append:${s.log}
StandardError=append:${s.log}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

const render = (platform: Platform, s: Service) => (platform === "darwin" ? renderLaunchd(s) : renderSystemd(s));

function manager(platform: Platform, path: string) {
  const env = { ...process.env, PATH: path };
  const call = (argv: string[], quiet = false): boolean => {
    const bin = Bun.which(argv[0] ?? "", { PATH: path });
    if (!bin) return fail(`${argv[0]} not found; it is needed to run the services`);
    const result = Bun.spawnSync([bin, ...argv.slice(1)], { env, stdout: quiet ? "ignore" : "inherit", stderr: quiet ? "ignore" : "inherit" });
    return result.exitCode === 0;
  };
  const uid = String(process.getuid?.() ?? 0);
  if (platform === "darwin") {
    return {
      stop: (s: Service) => { call(["launchctl", "bootout", `gui/${uid}/${s.name}`], true); },
      start: (s: Service) => call(["launchctl", "bootstrap", `gui/${uid}`, s.file]),
      reload: () => true,
    };
  }
  return {
    stop: (s: Service) => { call(["systemctl", "--user", "disable", "--now", s.name], true); },
    start: (s: Service) => call(["systemctl", "--user", "enable", s.name], true) && call(["systemctl", "--user", "restart", s.name]),
    reload: () => call(["systemctl", "--user", "daemon-reload"]),
  };
}

/** systemd's quoting for the subset written above: double-quoted words, backslash escapes, `%%`. */
function unitWords(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] ?? "").replaceAll("%%", "%"));
}

/** The environment an existing service file (hand-written or from an earlier run) gives its program. */
export function previousEnv(platform: Platform, file: string, path: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  if (platform === "darwin") {
    const plutil = Bun.which("plutil", { PATH: path });
    if (!plutil) return {};
    const out = Bun.spawnSync([plutil, "-convert", "json", "-o", "-", file], { stdout: "pipe", stderr: "ignore" });
    let parsed: unknown = null;
    try { parsed = out.success ? JSON.parse(out.stdout.toString()) : null; } catch { parsed = null; }
    const vars = isRecord(parsed) ? parsed.EnvironmentVariables : null;
    if (isRecord(vars)) for (const [k, v] of Object.entries(vars)) if (typeof v === "string") env[k] = v;
    return env;
  }
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("Environment=")) continue;
    for (const word of unitWords(line.slice("Environment=".length))) {
      const at = word.indexOf("=");
      if (at > 0) env[word.slice(0, at)] = word.slice(at + 1);
    }
  }
  return env;
}

/** Keep one copy of a hand-written service file (e.g. the Studio's manual plists) before replacing it. */
function writeServiceFile(s: Service, body: string): void {
  mkdirSync(dirname(s.file), { recursive: true });
  mkdirSync(dirname(s.log), { recursive: true });
  if (existsSync(s.file)) {
    const old = readFileSync(s.file, "utf8");
    if (old === body) return;
    if (!old.includes("Written by scripts/onboard.sh") && !existsSync(`${s.file}.before-onboard`)) {
      copyFileSync(s.file, `${s.file}.before-onboard`);
      console.log(`  kept the previous ${s.file} as ${s.file}.before-onboard`);
    }
  }
  writeFileSync(s.file, body);
}

// ---------------------------------------------------------------- install

function install(label: string, argv: string[], cwd: string, env: Record<string, string | undefined> = process.env): boolean {
  console.log(`installing ${label}: ${argv.slice(1).join(" ")} (${cwd.slice(ROOT.length + 1) || "."})`);
  const result = Bun.spawnSync([process.execPath, ...argv.slice(1)], { cwd, env, stdout: "inherit", stderr: "inherit" });
  return result.exitCode === 0;
}

function installApp(): void {
  // The private renderer is fetched over ssh; without access, fall back to the public install CI uses.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" };
  if (install("app", ["bun", "install", "--frozen-lockfile"], APP_DIR, env)) return;
  console.log("app install with the private renderer failed; installing the public app (private renderer excluded)");
  if (!install("public app", ["bun", join(ROOT, "scripts", "install-public-ci.ts")], ROOT)) fail("app install failed", 1);
}

// ---------------------------------------------------------------- health + pairing

interface State {
  version: 1;
  platform: Platform;
  profile: Profile;
  address: string;
  metro: string | null;
  services: { id: string; name: string; file: string; log: string }[];
  harnesses: HarnessReport[];
  hardware: Hardware;
  pair?: PairInfo;
}

interface PairInfo { code: string; link: string; expoGoLink?: string; expiresAt: number }

const credentialDir = () => process.env.DASH_CREDENTIAL_DIR || join(HOME, ".dash");
const statePath = () => join(credentialDir(), "onboard.json");

function readBootstrap(): string | null {
  try {
    return readFileSync(join(credentialDir(), "bootstrap-token"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Something accepts connections on host:port, a few seconds after our own service was stopped. */
async function portBusy(host: string, port: number): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const open = await Bun.connect({ hostname: host, port, socket: { data() {} } }).then((socket) => { socket.end(); return true; }, () => false);
    if (!open) return false;
    await sleep(500);
  }
  return true;
}
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null; }

async function waitFor(what: string, timeoutMs: number, probe: () => Promise<boolean>, log?: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await sleep(500);
  }
  const tail = log && existsSync(log) ? `\n--- last lines of ${log} ---\n${readFileSync(log, "utf8").split("\n").slice(-25).join("\n")}` : "";
  fail(`${what} did not come up within ${Math.round(timeoutMs / 1000)} s${tail}`, 1);
}

function parsePair(body: unknown): PairInfo | null {
  if (!isRecord(body) || typeof body.code !== "string" || typeof body.link !== "string" || typeof body.expiresAt !== "number") return null;
  return { code: body.code, link: body.link, expiresAt: body.expiresAt, ...(typeof body.expoGoLink === "string" ? { expoGoLink: body.expoGoLink } : {}) };
}

async function fetchPair(address: string): Promise<PairInfo> {
  const bootstrap = readBootstrap() ?? fail(`no bootstrap token in ${credentialDir()}; is the bridge running?`, 1);
  const response = await fetch(`http://${address}/pair`, { headers: { Authorization: `Bearer ${bootstrap}` } });
  const pair = response.ok ? parsePair(await response.json()) : null;
  return pair ?? fail(`GET /pair on ${address} answered ${response.status}`, 1);
}

function printQr(text: string): void {
  try {
    const mod: unknown = createRequire(join(BRIDGE_DIR, "package.json"))("qrcode-terminal");
    if (isRecord(mod) && typeof mod.generate === "function") mod.generate(text, { small: true });
  } catch {
    // The QR is a convenience; the link and code are printed regardless.
  }
}

function printPair(pair: PairInfo, metro: boolean): void {
  const until = new Date(pair.expiresAt).toLocaleTimeString();
  console.log(`\npair the phone (code ${pair.code}, valid until ${until}; \`scripts/onboard.sh --pair\` prints a fresh one)`);
  console.log(`  link       ${pair.link}`);
  if (pair.expoGoLink) console.log(`  expo go    ${pair.expoGoLink}`);
  console.log(`  token      paste the bootstrap token privately on Pair: cat ${join(credentialDir(), "bootstrap-token")}`);
  printQr(metro && pair.expoGoLink ? pair.expoGoLink : pair.link);
}

/** The two fields `--pair` needs from the state written by the last install. */
function readState(): { address: string; metro: boolean } | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    if (!isRecord(raw) || raw.version !== 1 || typeof raw.address !== "string") return null;
    return { address: raw.address, metro: typeof raw.metro === "string" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- main

function tailnetAddress(path: string): string | null {
  const out = run(["tailscale", "ip", "-4"], { ...stringEnv(process.env), PATH: path });
  return out?.split("\n").map((l) => l.trim()).find((l) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(l)) ?? null;
}

function stringEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (o.action === "help") { console.log(USAGE); return; }
  const shellPath = servicePath(o.platform, o.bridgeEnv.PATH ?? process.env.PATH);
  const files = { bridge: service(o.platform, "bridge", [], BRIDGE_DIR, {}).file, metro: service(o.platform, "metro", [], APP_DIR, {}).file };
  const prevBridge = o.action === "install" ? previousEnv(o.platform, files.bridge, shellPath) : {};
  const prevMetro = o.action === "install" ? previousEnv(o.platform, files.metro, shellPath) : {};
  // Folders an existing service already searched stay on PATH after this shell's own.
  const path = [...new Set([...shellPath.split(delimiter), ...(prevBridge.PATH ?? "").split(delimiter).filter((d) => d.startsWith("/"))])].join(delimiter);

  if (o.action === "uninstall") {
    const m = manager(o.platform, path);
    const ids: Service["id"][] = ["metro", "bridge"];
    for (const id of ids) {
      const s = service(o.platform, id, [], ROOT, {});
      if (!existsSync(s.file)) continue;
      if (o.dryRun) { console.log(`would stop and remove ${s.name} (${s.file})`); continue; }
      m.stop(s);
      rmSync(s.file, { force: true });
      console.log(`removed ${s.name}`);
      if (existsSync(`${s.file}.before-onboard`)) console.log(`  the file onboarding replaced is still at ${s.file}.before-onboard`);
    }
    if (!o.dryRun) { m.reload(); rmSync(statePath(), { force: true }); }
    console.log(`kept ${credentialDir()} (pairing credentials) and installed node_modules`);
    return;
  }

  if (o.action === "pair") {
    const state = readState() ?? fail("no onboarding state; run scripts/onboard.sh first");
    printPair(await fetchPair(state.address), state.metro);
    return;
  }

  const hw = detectHardware(o.platform);
  const profile: Profile = o.profile ?? (hw.memoryGiB >= FULL_PROFILE_MIN_GIB ? "full" : "minimal");
  console.log(`hardware   ${hw.platform} ${hw.arch} · ${hw.cpu} · ${hw.cores} cores · ${hw.memoryGiB} GiB${hw.gpu ? ` · ${hw.gpu}` : ""}`);
  console.log(`profile    ${profile}${o.profile ? "" : ` (chosen for ${hw.memoryGiB} GiB RAM; --minimal or --full to override)`}`);
  if (Bun.which("ffmpeg", { PATH: path }) === null) console.log(`note       ffmpeg not found: sonic pairing and voice are off; code pairing works${o.platform === "darwin" ? " (brew install ffmpeg)" : ""}`);

  const owned = new Set(["PATH", "HOME", "USER", "LANG", "DASH_PORT", "DASH_CWD"]);
  const keptBridge = Object.fromEntries(Object.entries(prevBridge).filter(([k]) => !owned.has(k) && !(k in o.bridgeEnv)));
  const keptMetro = Object.fromEntries(Object.entries(prevMetro).filter(([k]) => !owned.has(k) && !(k in o.metroEnv)));
  const port = o.port ?? (Number(prevBridge.DASH_PORT) || 4747);
  const cwd = o.cwd ?? prevBridge.DASH_CWD ?? HOME;
  // Names only: a kept value may be a credential.
  if (Object.keys(keptBridge).length) console.log(`kept       from the existing ${files.bridge}: ${Object.keys(keptBridge).join(", ")}`);
  if (Object.keys(keptMetro).length) console.log(`kept       from the existing ${files.metro}: ${Object.keys(keptMetro).join(", ")}`);
  const host = o.bridgeEnv.DASH_HOST ?? keptBridge.DASH_HOST ?? tailnetAddress(path);
  if (!host) {
    const how = o.platform === "darwin" ? "install Tailscale from https://tailscale.com/download/mac and sign in" : "install Tailscale (https://tailscale.com/download/linux) and run `sudo tailscale up`";
    if (!o.dryRun) fail(`no Tailscale address found; the bridge only listens on your tailnet. ${how}, then rerun.`);
    console.log(`warning    no Tailscale address found (${how})`);
  }
  const address = `${host ?? "<tailscale-ip>"}:${port}`;
  console.log(`bridge     ws://${address}/ws`);

  const step = (s: Step) => !o.skip.has(s) && !o.dryRun;
  if (step("deps") && !install("bridge", ["bun", "install", "--frozen-lockfile"], BRIDGE_DIR)) fail("bridge install failed", 1);
  if (profile === "full" && step("app-deps")) installApp();
  const before = discoverHarnesses(path);
  const wantsAdapters = profile === "full" || before.some((h) => !h.ready && h.cli && (h.id === "claude" || h.id === "codex"));
  if (wantsAdapters && step("adapters") && !install("ACP adapters", ["bun", "install", "--frozen-lockfile"], ADAPTERS_DIR)) fail("ACP adapter install failed", 1);
  const harnesses = discoverHarnesses(path);
  printHarnesses(harnesses);
  if (!harnesses.some((h) => h.ready)) console.log("note       no harness is ready yet; install one (e.g. Claude Code or Codex) and rerun to refresh the list");

  const base = { PATH: path, HOME, ...(process.env.USER ? { USER: process.env.USER } : {}), ...(process.env.LANG ? { LANG: process.env.LANG } : {}) };
  const services: Service[] = [service(o.platform, "bridge", [process.execPath, "run", "index.ts"], BRIDGE_DIR, {
    ...base,
    ...keptBridge,
    DASH_PORT: String(port),
    DASH_CWD: cwd,
    ...(profile === "full" && host ? { DASH_EXPO_GO_URL: `${host}:${o.metroPort}` } : {}),
    ...o.bridgeEnv,
    // Explicit PATH wins over any --env PATH: harness discovery above used exactly this one.
    PATH: path,
  })];
  if (profile === "full") {
    const workers = String(Math.min(8, Math.max(1, Math.floor(hw.cores / 2))));
    services.push(service(o.platform, "metro", [process.execPath, "node_modules/expo/bin/cli", "start", "--port", String(o.metroPort), "--host", "lan", "--max-workers", workers], APP_DIR, {
      ...base,
      ...keptMetro,
      EXPO_NO_TELEMETRY: "1",
      ...(host ? { REACT_NATIVE_PACKAGER_HOSTNAME: host } : {}),
      ...o.metroEnv,
    }));
  }

  if (o.dryRun) {
    for (const s of services) console.log(`\n--- ${s.file} ---\n${render(o.platform, s)}--- end ---`);
    console.log("\ndry run: nothing was installed, written or started");
    return;
  }
  if (o.skip.has("services")) { console.log("services skipped"); return; }

  const m = manager(o.platform, path);
  for (const s of services) writeServiceFile(s, render(o.platform, s));
  const plutil = o.platform === "darwin" ? Bun.which("plutil", { PATH: path }) : null;
  for (const s of plutil ? services : []) if (!Bun.spawnSync([plutil ?? "plutil", "-lint", s.file], { stdout: "ignore", stderr: "inherit" }).success) fail(`${s.file} is not a valid plist`, 1);
  // Minimal after full: retire the Metro service this profile no longer runs.
  const staleMetro = service(o.platform, "metro", [], APP_DIR, {});
  if (profile === "minimal" && existsSync(staleMetro.file)) { m.stop(staleMetro); rmSync(staleMetro.file); console.log(`removed ${staleMetro.name} (minimal profile)`); }
  m.reload();
  const state: State = { version: 1, platform: o.platform, profile, address, metro: profile === "full" ? `127.0.0.1:${o.metroPort}` : null, services: services.map(({ id, name, file, log }) => ({ id, name, file, log })), harnesses, hardware: hw };
  if (o.skip.has("start")) { console.log("services written; start skipped"); return; }
  for (const s of services) {
    m.stop(s);
    // Health below must come from this service, not an older bridge or Metro still holding the port.
    const [probeHost, probePort] = s.id === "bridge" ? [host ?? "127.0.0.1", port] : ["127.0.0.1", o.metroPort];
    if (await portBusy(probeHost, probePort)) fail(`${probeHost}:${probePort} is already in use by another process (an older ${s.id} started by hand?). Stop it, or pass ${s.id === "bridge" ? "--port" : "--metro-port"}.`);
    let started = m.start(s);
    // launchd can still be tearing down the old job right after bootout.
    for (let i = 0; !started && i < 5; i++) { await sleep(1000); started = m.start(s); }
    if (!started) fail(`could not start ${s.name}; see ${s.log}`, 1);
    console.log(`started    ${s.name}  (log ${s.log})`);
  }

  const bridge = services[0];
  await waitFor("the bridge", 60_000, async () => {
    const bootstrap = readBootstrap();
    if (!bootstrap) return false;
    return (await fetch(`http://${address}/`, { headers: { Authorization: `Bearer ${bootstrap}` }, signal: AbortSignal.timeout(2000) })).ok;
  }, bridge?.log);
  console.log(`healthy    bridge ws://${address}/ws`);
  const metro = services.find((s) => s.id === "metro");
  if (metro) {
    await waitFor("Metro", 180_000, async () => (await (await fetch(`http://127.0.0.1:${o.metroPort}/status`, { signal: AbortSignal.timeout(2000) })).text()).includes("packager-status:running"), metro.log);
    console.log(`healthy    Metro http://${host}:${o.metroPort}`);
  }
  state.pair = await fetchPair(address);
  mkdirSync(credentialDir(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(statePath(), 0o600);
  printPair(state.pair, metro !== undefined);
  if (o.platform === "linux" && run(["loginctl", "show-user", process.env.USER ?? "", "-p", "Linger", "--value"]) === "no") {
    console.log("\nnote       user services stop when you log out; `loginctl enable-linger` keeps the bridge running");
  }
  console.log(`\ndone. Rerun scripts/onboard.sh after installing a harness; scripts/onboard.sh --uninstall removes the services.`);
}

if (import.meta.main) await main();
