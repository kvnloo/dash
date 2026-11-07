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
    const botSessions = (bot: BotInfo) => {
      const anchor = host.agents.find(agent => agent.id === bot.agentId);
      const profile = anchor?.profileId ?? (anchor?.kind === "hermes" && anchor.id.startsWith("hermes:") ? anchor.id.slice("hermes:".length) : undefined);
      return sessions.filter(agent => agent.id === anchor?.id || (anchor && agent.kind === anchor.kind && profile !== undefined && agent.profileId === profile));
    };
    const claimed = new Set((host.bots ?? []).flatMap(bot => botSessions(bot).map(agent => agent.id)));
    const remaining = host.agents.filter(agent => !claimed.has(agent.id) && !(host.bots ?? []).some(bot => bot.agentId === agent.id));
    const kinds = [...new Set(remaining.map(agent => agent.kind))];
    const bots = host.bots;
    return {
      id: `host:${host.id}`, kind: "host", label: hostLabel(host), detail: host.address,
      meta: `${bots ? `${bots.length} bots · ` : ""}${sessions.length} chats`,
      status: host.online ? "running" : "offline", dimmed: !host.online,
      onLongPress: () => actions(host),
      children: () => [
        ...(bots ?? []).map((bot): TreeNode => {
          const chats = botSessions(bot);
          const anchor = host.agents.find(agent => agent.id === bot.agentId);
          return { id: `${host.id}:bot:${bot.id}`, kind: "bot", label: bot.name, detail: botSummary(bot), meta: `${chats.length} chats`, status: bot.status, dimmed: !host.online,
            botFace: (() => {
              const profile = (anchor ? hermesProfileKey(anchor) : undefined) ?? (bot.runtime === "hermes" && bot.id.startsWith("hermes-bot:") ? bot.id.slice(11) : undefined);
              const key = profile ?? bot.id;
              const linked = conversations.filter(chat => chat.targetHostId === host.id && (chats.some(agent => agent.sessionId === chat.sessionId) || (profile !== undefined && chat.harness === "hermes" && (chat.profileId === profile || chat.profileId === `hermes:${profile}`))));
              const states = linked.map(chat => ({ state: faceStateFromMessages(chat.messages, host.online), at: chat.updatedAt }));
              states.sort((a, b) => b.at - a.at);
              const live = states.find(item => item.state === "thinking" || item.state === "working" || item.state === "waiting-approval");
              return { identity: botFaceIdentity(key, bot.runtime), state: live?.state ?? states[0]?.state ?? "idle" };
            })(),
            onLongPress: () => actions(host, bot),
            children: () => chats.length ? chats.map(sessionNode) : [{ id: `${host.id}:bot:${bot.id}:new`, kind: "session", label: anchor ? "New chat" : "No sessions reported", onPress: anchor ? () => open(host, anchor) : undefined }],
          };
        }),
        ...kinds.map((kind): TreeNode => {
          const agents = remaining.filter(agent => agent.kind === kind);
          const chats = agents.filter(agent => agent.sessionId);
          const installed = agents.filter(agent => !agent.sessionId);
          return { id: `${host.id}:harness:${kind}`, kind: "harness", label: installed.length === 1 ? installed[0]?.name ?? kind : kind.toUpperCase(), meta: `${chats.length} chats`, dimmed: !host.online,
            status: host.online ? agents.some(agent => agent.status === "running") ? "running" : agents.some(agent => agent.status === "available") ? "available" : "offline" : "offline",
            children: () => [...chats.map(sessionNode), ...installed.map(agent => ({ id: `${host.id}:new:${agent.id}`, kind: "session", label: installed.length === 1 ? "New chat" : agent.name, detail: agent.detail, botFace: agentFace(agent), onPress: () => open(host, agent) } satisfies TreeNode))],
          };
        }),
        ...(!bots?.length && !kinds.length ? [{ id: `${host.id}:empty`, kind: "note", label: host.online ? "No harnesses or sessions reported" : "Host offline" } satisfies TreeNode] : []),
      ],
    };
  });
}
