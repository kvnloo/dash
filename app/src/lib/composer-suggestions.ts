import type { SuggestionInventory } from "../../../shared/suggestions";
import type { HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";

export interface ComposerTrigger { prefix: "/" | "@"; query: string; start: number; end: number }
export interface ComposerSuggestion { id: string; label: string; detail: string; insert: string }

export function composerTrigger(text: string, cursor = text.length): ComposerTrigger | null {
  const match = /(^|\s)([@/])([^\s@]*)$/.exec(text.slice(0, cursor));
  if (!match || (match[2] !== "@" && match[2] !== "/")) return null;
  const start = match.index + (match[1]?.length ?? 0);
  // Slash commands belong at the start, not inside prose or paths.
  if (match[2] === "/" && (text.slice(0, start).trim() || match[3]?.includes("/"))) return null;
  return { prefix: match[2], query: (match[3] ?? "").toLowerCase(), start, end: cursor };
}

export function insertSuggestion(text: string, trigger: ComposerTrigger, insert: string): string {
  return `${text.slice(0, trigger.start)}${insert} ${text.slice(trigger.end).trimStart()}`;
}

export function composerSuggestions(trigger: ComposerTrigger, inventory: SuggestionInventory, conversations: Conversation[], hosts: HostInfo[]): ComposerSuggestion[] {
  const rows: ComposerSuggestion[] = trigger.prefix === "/"
    ? inventory.commands.map(command => ({ id: `command:${command.name}`, label: `/${command.name}`, detail: command.description, insert: `/${command.name}` }))
    : [
      ...conversations.map(chat => ({ id: `chat:${chat.id}`, label: `@${chat.title}`, detail: `${chat.harness} · session`, insert: `@${chat.sessionId ?? chat.id}` })),
      ...hosts.flatMap(host => [
        ...(host.bots ?? []).map(bot => ({ id: `bot:${host.id}:${bot.id}`, label: `@${bot.name}`, detail: `${host.name} · bot`, insert: `@${bot.name}` })),
        ...host.agents.map(agent => ({ id: `agent:${host.id}:${agent.id}`, label: `@${agent.name}`, detail: `${host.name} · ${agent.kind}`, insert: `@${agent.name}` })),
      ]),
      ...inventory.files.map(path => ({ id: `file:${path}`, label: `@${path}`, detail: "Workspace file", insert: `@${path}` })),
    ];
  return rows.filter(row => `${row.label} ${row.detail}`.toLowerCase().includes(trigger.query)).slice(0, 30);
}
