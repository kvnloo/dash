// Bots pane model. A bot is a deployed messaging identity (a Hermes gateway profile on
// Telegram/Discord, OpenDots, GrokBot) reported by the host in `HostInfo.bots`. Harnesses and
// sessions are not bots; see docs/design/language.md#glossary.
import type { BotChannel, BotInfo, HostInfo } from "../../../shared/protocol";
import type { AgentTarget } from "../mock/agents";
import { profileFromAgent } from "./roster";

const PLATFORM_NAMES: Record<string, string> = {
  telegram: "Telegram", discord: "Discord", slack: "Slack", signal: "Signal", whatsapp: "WhatsApp",
  matrix: "Matrix", mattermost: "Mattermost", feishu: "Feishu", dingtalk: "DingTalk", wecom: "WeCom",
  qqbot: "QQ", email: "Email", sms: "SMS", imessage: "iMessage", line: "LINE",
};

export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

const STATE_ORDER: BotChannel["state"][] = ["connected", "retrying", "disconnected", "configured"];
const STATE_WORD: Record<BotChannel["state"], string> = { connected: "connected", retrying: "reconnecting", disconnected: "disconnected", configured: "not running" };

/** One muted line: "Telegram connected · Discord not running". Services say what they are. */
export function botSummary(bot: BotInfo): string {
  if (bot.channels.length === 0) return bot.detail ?? (bot.status === "running" ? "Running" : "Not running");
  const parts: string[] = [];
  for (const state of STATE_ORDER) {
    const names = bot.channels.filter(c => c.state === state).map(c => platformName(c.platform));
    if (names.length) parts.push(`${names.join(", ")} ${STATE_WORD[state]}`);
  }
  return parts.join(" · ");
}

export type BotsRow =
  | { kind: "host"; id: string; host: HostInfo; count: number | null; collapsed: boolean }
  | { kind: "bot"; id: string; host: HostInfo; bot: BotInfo }
  | { kind: "note"; id: string; text: string };

/** Host sections in roster order; a collapsed host shows only its header. */
export function botsRows(hosts: readonly HostInfo[], collapsed: ReadonlySet<string>): BotsRow[] {
  const rows: BotsRow[] = [];
  for (const host of hosts) {
    const bots = host.bots;
    const closed = collapsed.has(host.id);
    rows.push({ kind: "host", id: `host:${host.id}`, host, count: bots ? bots.length : null, collapsed: closed });
    if (closed) continue;
    if (!bots) {
      rows.push({ kind: "note", id: `note:${host.id}`, text: host.online ? "This host's bridge does not report bots yet." : "Offline" });
      continue;
    }
    if (bots.length === 0) {
      rows.push({ kind: "note", id: `note:${host.id}`, text: "No bots deployed here." });
      continue;
    }
    for (const bot of bots) rows.push({ kind: "bot", id: `bot:${host.id}:${bot.id}`, host, bot });
  }
  return rows;
}

export function hostCountLabel(count: number | null): string {
  if (count === null) return "";
  return `${count} bot${count === 1 ? "" : "s"}`;
}

export function toggleCollapsed(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Persisted collapsed host ids. Anything malformed means "all expanded". */
export function parseCollapsed(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200)) : new Set();
  } catch {
    return new Set();
  }
}

/** The chat target for a bot, when the host lists the agent behind it. */
export function botTarget(host: HostInfo, bot: BotInfo): AgentTarget | undefined {
  if (!bot.agentId) return undefined;
  const agent = host.agents.find(a => a.id === bot.agentId);
  return agent ? profileFromAgent(host, agent) : undefined;
}

export const COLLAPSED_KEY = "dash.bots.collapsed.v1";
