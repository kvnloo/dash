// New-agent sheet model: what the paired computer can start, grouped the way people think of it.
// Harnesses are agent CLIs on the host; Cloud harnesses run on a provider's machines (Cursor);
// bots are deployed identities whose chat the host can start (BotInfo.spawn). Pure: no store.
import type { BotInfo, HarnessInfo, HostInfo } from "../../../shared/protocol";

export interface NewAgentRow {
  id: string;
  kind: "harness" | "bot";
  name: string;
  harness: string;
  profileId?: string;
  profileName?: string;
  disabled: boolean;
  /** A live process or connected channel stands behind this row. */
  live: boolean;
  detail?: string;
  label: string;
  hint?: string;
}

export interface NewAgentSection { id: "harnesses" | "cloud" | "bots"; title: string; rows: NewAgentRow[] }

function harnessRow(h: HarnessInfo): NewAgentRow {
  const cloud = h.where === "cloud";
  const detail = h.available ? (cloud ? "Runs in the cloud on a GitHub repository" : "Installed") : h.hint ?? "Not installed";
  return {
    id: `harness-${h.id}`, kind: "harness", name: h.name, harness: h.id, disabled: !h.available, live: false, detail,
    label: h.available ? `New ${h.name} agent` : `${h.name}, unavailable`,
    hint: h.available ? undefined : detail,
  };
}

function botRow(bot: BotInfo): NewAgentRow {
  const spawn = bot.spawn;
  const profile = spawn?.harness === "hermes" && spawn.profileId.startsWith("hermes:") ? spawn.profileId.slice("hermes:".length) : undefined;
  const disabled = !spawn?.available;
  const what = bot.runtime === "hermes" ? "Hermes bot" : bot.runtime === "grok" ? "Grok" : bot.detail ?? bot.runtime;
  const detail = !spawn ? "Dash can't start this bot" : !spawn.available ? spawn.hint ?? "Unavailable on this host" : what;
  return {
    id: `bot-${bot.id}`, kind: "bot", name: bot.name, harness: spawn?.harness ?? bot.runtime,
    // GrokBot is a plain Grok chat; a Hermes bot routes to its profile.
    ...(profile ? { profileId: spawn?.profileId, profileName: profile } : {}),
    disabled, live: bot.status === "running", detail,
    label: disabled ? `${bot.name}, unavailable` : `New ${bot.name} agent`,
    hint: disabled ? detail : undefined,
  };
}

export function newAgentSections(connection: { harnesses: readonly HarnessInfo[]; hosts: readonly HostInfo[]; host?: string }): NewAgentSection[] {
  const host = connection.hosts.find(h => h.self);
  const where = connection.host || host?.name || "this computer";
  const local = connection.harnesses.filter(h => h.where !== "cloud").map(harnessRow);
  const cloud = connection.harnesses.filter(h => h.where === "cloud").map(harnessRow);
  const bots = (host?.bots ?? []).map(botRow);
  const sections: NewAgentSection[] = [];
  if (local.length) sections.push({ id: "harnesses", title: `Harnesses on ${where}`, rows: local });
  if (cloud.length) sections.push({ id: "cloud", title: "Cloud", rows: cloud });
  if (bots.length) sections.push({ id: "bots", title: `Bots on ${where}`, rows: bots });
  return sections;
}
