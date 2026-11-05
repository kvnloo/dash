import type { AgentInfo, BotInfo, HostInfo } from "../../../shared/protocol";
import { botSummary } from "./bots";
import type { TreeNode } from "./tree";
import { conversationThinking } from "./thinking";
import type { Conversation } from "../model";
import { botFaceIdentity, faceStateFromMessages, hermesProfileKey } from "./moodie-identity";

/** Display the real OS hostname without changing the MagicDNS routing id. */
export function hostLabel(host: HostInfo): string {
  return host.hostname.trim() || host.name;
}

function activity(at: number | undefined, now: number): string | undefined {
  if (at === undefined) return undefined;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

const HARNESS_LABELS: Record<string, string> = { hermes: "Hermes", claude: "Claude Code", codex: "Codex", omp: "omp", opencode: "OpenCode", pi: "pi", service: "Services" };
/** One stable name per harness kind, so sibling rows never mix casing or naming schemes. */
export const harnessLabel = (kind: string): string => HARNESS_LABELS[kind] ?? kind;

export function hostsTree(hosts: readonly HostInfo[], open: (host: HostInfo, agent: AgentInfo) => void, actions: (host: HostInfo, bot?: BotInfo) => void, now = Date.now(), conversations: readonly Conversation[] = []): TreeNode[] {
  return hosts.map(host => {
    if (host.kind === "phone") return {
      id: `host:${host.id}`, kind: "host", label: hostLabel(host), detail: host.address,
      meta: "Phone", status: host.online ? "running" : "offline", dimmed: !host.online,
      onLongPress: () => actions(host),
      children: () => [{ id: `${host.id}:empty`, kind: "note", label: "No harnesses on a phone" }],
    } satisfies TreeNode;
    const sessions = host.agents.filter(agent => agent.sessionId);
    const agentFace = (agent: AgentInfo): TreeNode["botFace"] => {
      const profile = hermesProfileKey(agent);
      if (!profile) return undefined;
      const chat = conversations.find(chat => chat.sessionId === agent.sessionId && chat.targetHostId === host.id && agent.sessionId);
      return { identity: botFaceIdentity(profile), state: faceStateFromMessages(chat?.messages ?? [], host.online) };
    };
    const sessionNode = (agent: AgentInfo): TreeNode => ({
      id: `${host.id}:session:${agent.id}`, kind: "session", label: agent.name,
      detail: agent.openIn ? `Open in ${agent.openIn}` : undefined,
      meta: activity(agent.lastActivityAt, now), status: host.online ? agent.status : "offline", dimmed: !host.online,
      thinking: conversationThinking(conversations.find(chat => chat.sessionId === agent.sessionId && chat.targetHostId === host.id)?.messages ?? [], host.online ? "online" : "offline"),
      botFace: agentFace(agent),
      onPress: () => open(host, agent),
      children: agent.cwd ? () => [{ id: `${host.id}:repo:${agent.id}`, kind: "repo", label: agent.cwd?.split("/").filter(Boolean).pop() ?? "Repository", detail: agent.cwd }] : undefined,
    });
    const bots = host.bots ?? [];
    // One level per kind: Host → Harness → Profile/Bot → Chat. Bots sit under the harness that runs them,
    // and harness sessions carrying a profile are grouped under that profile, never listed beside it.
    const agentProfile = (agent: AgentInfo): string | undefined =>
      agent.profileId ?? (!agent.sessionId && agent.id.startsWith(`${agent.kind}:`) ? agent.id.slice(agent.kind.length + 1) : undefined);
    const botProfile = (bot: BotInfo): string | undefined => {
      const anchor = host.agents.find(agent => agent.id === bot.agentId);
      if (anchor) return agentProfile(anchor);
      const prefix = `${bot.runtime}-bot:`;
      return bot.id.startsWith(prefix) ? bot.id.slice(prefix.length) : undefined;
    };
    const kinds = [...new Set([...host.agents.map(agent => agent.kind), ...bots.map(bot => bot.runtime)])];
    const harnessNode = (kind: string): TreeNode => {
      const agents = host.agents.filter(agent => agent.kind === kind);
      type Group = { key: string; bot?: BotInfo; chats: AgentInfo[]; anchors: AgentInfo[] };
      const groups = new Map<string, Group>();
      const group = (key: string) => groups.get(key) ?? (groups.set(key, { key, chats: [], anchors: [] }), groups.get(key)!);
      for (const bot of bots.filter(item => item.runtime === kind)) group(botProfile(bot) ?? `bot:${bot.id}`).bot = bot;
      const loose: AgentInfo[] = [];
      for (const agent of agents) {
        const owner = bots.find(bot => bot.agentId === agent.id);
        const key = owner ? botProfile(owner) ?? `bot:${owner.id}` : agentProfile(agent);
        if (key === undefined) { loose.push(agent); continue; }
        const entry = group(key);
        (agent.sessionId ? entry.chats : entry.anchors).push(agent);
      }
      const ordered = [...groups.values()].sort((x, y) => Number(!x.bot) - Number(!y.bot) || y.chats.length - x.chats.length || x.key.localeCompare(y.key));
      const chats = agents.filter(agent => agent.sessionId);
      const installed = loose.filter(agent => !agent.sessionId);
      const newChat = (agent: AgentInfo, label = "New chat"): TreeNode => ({ id: `${host.id}:new:${agent.id}`, kind: "session", label, detail: agent.detail, botFace: agentFace(agent), onPress: () => open(host, agent) });
      const profileNode = ({ key, bot, chats: own, anchors }: Group): TreeNode => {
        const profile = bot ? botProfile(bot) : key;
        const face: TreeNode["botFace"] = (() => {
          const linked = conversations.filter(chat => chat.targetHostId === host.id && (own.some(agent => agent.sessionId === chat.sessionId) || (profile !== undefined && chat.harness === kind && (chat.profileId === profile || chat.profileId === `${kind}:${profile}`))));
          const states = linked.map(chat => ({ state: faceStateFromMessages(chat.messages, host.online), at: chat.updatedAt })).sort((x, y) => y.at - x.at);
          const live = states.find(item => item.state === "thinking" || item.state === "working" || item.state === "waiting-approval");
          return { identity: botFaceIdentity(profile ?? bot?.id ?? key, bot?.runtime ?? kind), state: live?.state ?? states[0]?.state ?? "idle" };
        })();
        return { id: `${host.id}:${kind}:profile:${key}`, kind: "bot", label: bot?.name ?? key, detail: bot ? botSummary(bot) : undefined, meta: `${own.length} chats`,
          status: bot?.status ?? (host.online ? (own.some(agent => agent.status === "running") ? "running" : "available") : "offline"), dimmed: !host.online, botFace: face,
          onLongPress: bot ? () => actions(host, bot) : undefined,
          children: () => {
            const rows = [...own.map(sessionNode), ...anchors.map(agent => newChat(agent))];
            return rows.length ? rows : [{ id: `${host.id}:${kind}:profile:${key}:empty`, kind: "note", label: "No sessions reported" }];
          },
        };
      };
      return { id: `${host.id}:harness:${kind}`, kind: "harness", label: harnessLabel(kind),
        meta: `${groups.size ? `${groups.size} ${kind === "hermes" ? "profiles" : "bots"} · ` : ""}${chats.length} chats`, dimmed: !host.online,
        status: host.online ? agents.some(agent => agent.status === "running") || bots.some(bot => bot.runtime === kind && bot.status === "running") ? "running" : "available" : "offline",
        children: () => [...ordered.map(profileNode), ...loose.filter(agent => agent.sessionId).map(sessionNode), ...installed.map(agent => newChat(agent, installed.length === 1 ? "New chat" : agent.name))],
      };
    };
    return {
      id: `host:${host.id}`, kind: "host", label: hostLabel(host), detail: host.address,
      meta: `${kinds.length} harnesses · ${sessions.length} chats`,
      status: host.online ? "running" : "offline", dimmed: !host.online,
      onLongPress: () => actions(host),
      children: () => kinds.length ? kinds.map(harnessNode) : [{ id: `${host.id}:empty`, kind: "note", label: host.online ? "No harnesses or sessions reported" : "Host offline" }],
    };
  });
}
