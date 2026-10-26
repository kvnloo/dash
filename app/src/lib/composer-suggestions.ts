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

export const SUGGESTION_LIMIT = 30;

/** Filter first, then build at most 30 rows: cost follows the matches shown, not every chat. */
export function composerSuggestions(trigger: ComposerTrigger, inventory: SuggestionInventory, conversations: readonly Pick<Conversation, "id" | "title" | "harness" | "sessionId">[], hosts: HostInfo[]): ComposerSuggestion[] {
  const rows: ComposerSuggestion[] = [];
  const add = (row: ComposerSuggestion) => {
    if (rows.length < SUGGESTION_LIMIT && `${row.label} ${row.detail}`.toLowerCase().includes(trigger.query)) rows.push(row);
    return rows.length >= SUGGESTION_LIMIT;
  };
  if (trigger.prefix === "/") {
    for (const command of inventory.commands) if (add({ id: `command:${command.name}`, label: `/${command.name}`, detail: command.description, insert: `/${command.name}` })) break;
    return rows;
  }
  for (const chat of conversations) {
    const label = `@${chat.title}`, detail = `${chat.harness} · session`;
    if (!`${label} ${detail}`.toLowerCase().includes(trigger.query)) continue;
    if (add({ id: `chat:${chat.id}`, label, detail, insert: `@${chat.sessionId ?? chat.id}` })) return rows;
  }
  for (const host of hosts) {
    for (const bot of host.bots ?? []) if (add({ id: `bot:${host.id}:${bot.id}`, label: `@${bot.name}`, detail: `${host.name} · bot`, insert: `@${bot.name}` })) return rows;
    for (const agent of host.agents) if (add({ id: `agent:${host.id}:${agent.id}`, label: `@${agent.name}`, detail: `${host.name} · ${agent.kind}`, insert: `@${agent.name}` })) return rows;
  }
  for (const path of inventory.files) if (add({ id: `file:${path}`, label: `@${path}`, detail: "Workspace file", insert: `@${path}` })) return rows;
  return rows;
}
