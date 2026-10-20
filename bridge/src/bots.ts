// Bots: deployed messaging identities on this host, as opposed to harnesses (agent
// CLIs/runtimes) and sessions (conversations). See docs/design/language.md#glossary.
//
// Sources, all read-only:
// - Hermes profiles (`~/.hermes` and `~/.hermes/profiles/*`): messaging platforms enabled in
//   config.yaml (`platforms.<name>.enabled` or `gateway.platforms.<name>.enabled`).
// - Each live Hermes gateway's `gateway_state.json`: per-platform link state. A multiplexing
//   gateway reports other profiles as `<profile>:<platform>`.
// - Running user services whose unit name says bot/dots (e.g. an OpenDots or GrokBot unit),
//   and the GrokBot desktop process.
// Tokens and .env values are never read here.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { BotChannel, BotInfo } from "../../shared/protocol";

/** Chat platforms a person messages. `api_server`, `a2a` and webhooks are plumbing, not bots. */
export const MESSAGING_PLATFORMS = new Set([
  "telegram", "discord", "slack", "signal", "whatsapp", "matrix", "mattermost",
  "feishu", "dingtalk", "wecom", "qqbot", "email", "sms", "imessage", "line",
]);

const PROFILE_OK = /^[A-Za-z0-9._-]{1,64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Messaging platforms switched on in one profile's parsed config. */
export function enabledPlatforms(config: unknown): string[] {
  if (!record(config)) return [];
  const out = new Set<string>();
  const sections = [config.platforms, record(config.gateway) ? config.gateway.platforms : undefined];
  for (const section of sections) {
    if (!record(section)) continue;
    for (const [name, value] of Object.entries(section)) {
      if (MESSAGING_PLATFORMS.has(name) && record(value) && value.enabled === true) out.add(name);
    }
  }
  return [...out].sort();
}

export interface GatewayState {
  home: string;
  alive: boolean;
  platforms: Record<string, string>;
}

/** Parse `gateway_state.json`. `alive` is decided by the caller from the recorded pid. */
export function parseGatewayState(raw: unknown, alive: (pid: number) => boolean): GatewayState | null {
  if (!record(raw) || typeof raw.pid !== "number" || typeof raw.hermes_home !== "string") return null;
  const platforms: Record<string, string> = {};
  if (record(raw.platforms)) {
    for (const [key, value] of Object.entries(raw.platforms)) {
      if (record(value) && typeof value.state === "string") platforms[key] = value.state;
    }
  }
  const running = raw.gateway_state === "running" || raw.gateway_state === "starting";
  return { home: raw.hermes_home, alive: running && alive(raw.pid), platforms };
}

export function channelState(raw: string): BotChannel["state"] {
  if (raw === "connected") return "connected";
  if (raw === "retrying" || raw === "connecting" || raw === "reconnecting" || raw === "starting") return "retrying";
  return "disconnected";
}

/**
 * One profile's channels: configured platforms, overlaid with what any live gateway reports
 * for it. Plain keys belong to the gateway's own home; `<profile>:<platform>` keys come from
 * a multiplexing gateway.
 */
export function profileChannels(profile: { id: string; home: string }, configured: readonly string[], states: readonly GatewayState[], same: (a: string, b: string) => boolean): BotChannel[] {
  const channels = new Map<string, BotChannel["state"]>();
  for (const platform of configured) channels.set(platform, "configured");
  for (const state of states) {
    if (!state.alive) continue;
    const own = same(state.home, profile.home);
    for (const [key, raw] of Object.entries(state.platforms)) {
      const colon = key.indexOf(":");
      const owner = colon > 0 ? key.slice(0, colon) : undefined;
      const platform = colon > 0 ? key.slice(colon + 1) : key;
      if (!MESSAGING_PLATFORMS.has(platform)) continue;
      if (owner === undefined ? !own : owner !== profile.id) continue;
      const next = channelState(raw);
      const prev = channels.get(platform);
      // Prefer the best live report when two gateways mention the same platform.
      if (prev === undefined || prev === "configured" || rank(next) > rank(prev)) channels.set(platform, next);
    }
  }
  return [...channels].sort(([a], [b]) => a.localeCompare(b)).map(([platform, state]) => ({ platform, state }));
}

function rank(state: BotChannel["state"]): number {
  return state === "connected" ? 3 : state === "retrying" ? 2 : state === "disconnected" ? 1 : 0;
}

export function botStatus(channels: readonly BotChannel[]): BotInfo["status"] {
  return channels.some(c => c.state === "connected") ? "running" : "available";
}

export interface HermesBotSources {
  root: string;
  read(path: string): string | null;
  list(dir: string): string[];
  parseYaml(text: string): unknown;
  alive(pid: number): boolean;
  same(a: string, b: string): boolean;
}

export function hermesBots(src: HermesBotSources): BotInfo[] {
  const profiles = [{ id: "default", home: src.root }, ...src.list(join(src.root, "profiles")).filter(n => PROFILE_OK.test(n)).map(id => ({ id, home: join(src.root, "profiles", id) }))];
  const states: GatewayState[] = [];
  for (const profile of profiles) {
    const text = src.read(join(profile.home, "gateway_state.json"));
    if (!text) continue;
    try {
      const state = parseGatewayState(JSON.parse(text), src.alive);
      if (state) states.push(state);
    } catch { /* a torn write; skip this gateway */ }
  }
  const bots: BotInfo[] = [];
  const seen: string[] = [];
  for (const profile of profiles) {
    if (seen.some(home => src.same(home, profile.home))) continue;
    seen.push(profile.home);
    let config: unknown;
    const text = src.read(join(profile.home, "config.yaml"));
    try { config = text ? src.parseYaml(text) : undefined; } catch { config = undefined; }
    const channels = profileChannels(profile, enabledPlatforms(config), states, src.same);
    if (channels.length === 0) continue;
    bots.push({
      id: `hermes-bot:${profile.id}`,
      name: profile.id,
      runtime: "hermes",
      status: botStatus(channels),
      channels,
      agentId: `hermes:${profile.id}`,
      detail: "Hermes gateway profile",
    });
  }
  return bots;
}

/** Running user units whose name marks a bot (`opendots.service`, `grokbot.service`, `x-bot.service`). */
export function serviceBots(listing: string): BotInfo[] {
  const out: BotInfo[] = [];
  for (const line of listing.split("\n")) {
    const unit = line.trim().split(/\s+/)[0] ?? "";
    const m = /^([A-Za-z0-9@._-]+)\.service$/.exec(unit);
    if (!m?.[1] || /^hermes/i.test(m[1])) continue;
    if (!/(^|[-_.@])(\w*bot|\w*dots)($|[-_.@])/i.test(m[1])) continue;
    out.push({ id: `service:${m[1]}`, name: m[1], runtime: "service", status: "running", channels: [], detail: "User service" });
  }
  return out;
}

export function grokDesktopBot(): BotInfo {
  return { id: "grok-bot", name: "GrokBot", runtime: "grok", status: "running", channels: [], agentId: "grok-bot", detail: "Desktop app" };
}

/** Real filesystem sources for this host. */
export function hostBotSources(root: string, alive: (pid: number) => boolean): HermesBotSources {
  return {
    root,
    read: path => { try { return readFileSync(path, "utf8"); } catch { return null; } },
    list: dir => { try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name).sort(); } catch { return []; } },
    parseYaml: text => Bun.YAML.parse(text),
    alive,
    same: (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return a === b; } },
  };
}
