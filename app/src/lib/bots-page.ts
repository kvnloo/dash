// Bots page prototype model (DA-073). Bots are deployed messaging identities reported in
// `HostInfo.bots` (docs/design/language.md#glossary). This file only arranges them for the
// gem table, the orrery and the simple bot page; it never invents a bot or a channel.
import type { BotChannel, BotInfo, HostInfo } from "../../../shared/protocol";
import { platformName } from "./bots";
import { hostLabel } from "./hosts-tree";

export type GemFamily = "hermes" | "grok" | "service" | "other";
/** Semantic status only: ok/warn/danger/idle map to theme status colours, never gold. */
export type GemTone = "ok" | "warn" | "danger" | "idle" | "offline";

export interface BotGem {
  id: string;
  /** 1-based position in the table, like an atomic number. Stable for one roster. */
  number: number;
  /** Two-letter element symbol, unique on the page. */
  symbol: string;
  name: string;
  family: GemFamily;
  hostId: string;
  hostName: string;
  hostOnline: boolean;
  tone: GemTone;
  stateWord: string;
  host: HostInfo;
  bot: BotInfo;
}

const FAMILY_ORDER: GemFamily[] = ["hermes", "grok", "service", "other"];
export const FAMILY_LABEL: Record<GemFamily, string> = { hermes: "Hermes profile", grok: "Grok", service: "Service", other: "Bot" };

export function gemFamily(runtime: string): GemFamily {
  return runtime === "hermes" || runtime === "grok" || runtime === "service" ? runtime : "other";
}

const CHANNEL_WORD: Record<BotChannel["state"], string> = { connected: "Connected", retrying: "Reconnecting", disconnected: "Disconnected", configured: "Not running" };
const CHANNEL_TONE: Record<BotChannel["state"], GemTone> = { connected: "ok", retrying: "warn", disconnected: "danger", configured: "idle" };

/** One honest word for the whole bot: the best live channel wins, an offline host wins over all. */
export function gemTone(bot: BotInfo, hostOnline: boolean): { tone: GemTone; word: string } {
  if (!hostOnline) return { tone: "offline", word: "Host offline" };
  for (const state of ["connected", "retrying", "disconnected"] as const) {
    if (bot.channels.some(c => c.state === state)) return { tone: CHANNEL_TONE[state], word: CHANNEL_WORD[state] };
  }
  if (bot.status === "running") return { tone: "ok", word: "Running" };
  if (bot.status === "offline") return { tone: "offline", word: "Offline" };
  return { tone: "idle", word: "Not running" };
}

/** Element-style symbol: first letter, then the first later letter that keeps it unique. */
export function gemSymbol(name: string, taken: ReadonlySet<string>): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  const first = (letters[0] ?? "B").toUpperCase();
  for (const next of letters.slice(1)) {
    const symbol = first + next.toLowerCase();
    if (!taken.has(symbol)) return symbol;
  }
  for (let n = 1; n < 100; n++) if (!taken.has(`${first}${n}`)) return `${first}${n}`;
  return first;
}

/** Every bot on every non-phone host, ordered by family then host (roster order) then name. */
export function botGems(hosts: readonly HostInfo[]): BotGem[] {
  const rows = hosts.flatMap((host, hostIndex) => host.kind === "phone" ? [] : (host.bots ?? []).map(bot => ({ host, bot, hostIndex })));
  rows.sort((a, b) => FAMILY_ORDER.indexOf(gemFamily(a.bot.runtime)) - FAMILY_ORDER.indexOf(gemFamily(b.bot.runtime)) || a.hostIndex - b.hostIndex || a.bot.name.localeCompare(b.bot.name));
  const taken = new Set<string>();
  return rows.map(({ host, bot }, index) => {
    const symbol = gemSymbol(bot.name, taken);
    taken.add(symbol);
    const { tone, word } = gemTone(bot, host.online);
    return { id: `${host.id}:${bot.id}`, number: index + 1, symbol, name: bot.name, family: gemFamily(bot.runtime), hostId: host.id, hostName: hostLabel(host), hostOnline: host.online, tone, stateWord: word, host, bot };
  });
}

/** "3 bots on 2 hosts · 1 connected". Counts only what hosts report. */
export function gemsSummary(gems: readonly BotGem[], hosts: readonly HostInfo[]): string {
  const computers = hosts.filter(h => h.kind !== "phone");
  if (computers.length === 0) return "Pair a computer to see its bots.";
  if (gems.length === 0) return computers.every(h => !h.bots) ? "These hosts do not report bots yet." : "No bots deployed on your hosts.";
  const hostCount = new Set(gems.map(g => g.hostId)).size;
  const live = gems.filter(g => g.tone === "ok").length;
  return `${gems.length} bot${gems.length === 1 ? "" : "s"} on ${hostCount} host${hostCount === 1 ? "" : "s"} · ${live} live`;
}

export interface GemChannelRow { id: string; label: string; word: string; tone: GemTone }

export function gemChannels(gem: BotGem): GemChannelRow[] {
  return gem.bot.channels.map(c => ({ id: c.platform, label: platformName(c.platform), word: gem.hostOnline ? CHANNEL_WORD[c.state] : "Host offline", tone: gem.hostOnline ? CHANNEL_TONE[c.state] : "offline" }));
}

export interface OrreryHost { id: string; label: string; online: boolean; gems: BotGem[] }

/** One orrery per host that has bots, in roster order. */
export function orreryHosts(gems: readonly BotGem[]): OrreryHost[] {
  const out = new Map<string, OrreryHost>();
  for (const gem of gems) {
    const entry = out.get(gem.hostId) ?? { id: gem.hostId, label: gem.hostName, online: gem.hostOnline, gems: [] };
    entry.gems.push(gem);
    out.set(gem.hostId, entry);
  }
  return [...out.values()];
}

export const ORBIT_INNER = 6;

/**
 * Static orbit slots (no continuous motion: MOTION.md caps travel at 180ms). The first six
 * bots share the inner ring, the rest the outer ring. Unit radii; 0deg is twelve o'clock.
 */
export function orbitSlots(count: number): { ring: 0 | 1; x: number; y: number }[] {
  const inner = Math.min(count, ORBIT_INNER);
  const outer = count - inner;
  const place = (i: number, n: number, ring: 0 | 1, phase: number) => {
    const angle = (2 * Math.PI * i) / n + phase - Math.PI / 2;
    const r = ring === 0 ? 0.55 : 1;
    return { ring, x: Math.round(Math.cos(angle) * r * 1000) / 1000, y: Math.round(Math.sin(angle) * r * 1000) / 1000 };
  };
  return [
    ...Array.from({ length: inner }, (_, i) => place(i, inner, 0, 0)),
    ...Array.from({ length: outer }, (_, i) => place(i, outer, 1, Math.PI / Math.max(outer, 1))),
  ];
}
