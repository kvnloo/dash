import type { SuggestionInventory } from "../../../shared/suggestions";
import type { HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";

export interface ComposerTrigger { prefix: "/" | "@"; query: string; start: number; end: number }
export interface ComposerSuggestion { id: string; label: string; detail: string; insert: string }

function isOffset(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Reject records that did not come from composerTrigger (wrong prefix, missing query, bad span). */
function assertTrigger(trigger: unknown): asserts trigger is ComposerTrigger {
  if (typeof trigger !== "object" || trigger === null || Array.isArray(trigger)) throw new TypeError("Invalid composer trigger.");
  const prefix: unknown = Reflect.get(trigger, "prefix");
  const query: unknown = Reflect.get(trigger, "query");
  const start: unknown = Reflect.get(trigger, "start");
  const end: unknown = Reflect.get(trigger, "end");
  if ((prefix !== "/" && prefix !== "@") || typeof query !== "string") throw new TypeError("Invalid composer trigger.");
  if (!isOffset(start, Number.MAX_SAFE_INTEGER) || !isOffset(end, Number.MAX_SAFE_INTEGER) || start > end) throw new TypeError("Invalid composer trigger span.");
}

export function composerTrigger(text: string, cursor = text.length): ComposerTrigger | null {
  // An out-of-range caret must not slice the draft into a trigger the user never typed.
  if (!isOffset(cursor, text.length)) return null;
  const match = /(^|\s)([@/])([^\s@]*)$/.exec(text.slice(0, cursor));
  if (!match || (match[2] !== "@" && match[2] !== "/")) return null;
  const start = match.index + (match[1]?.length ?? 0);
  // Slash commands belong at the start, not inside prose or paths.
  if (match[2] === "/" && (text.slice(0, start).trim() || match[3]?.includes("/"))) return null;
  return { prefix: match[2], query: (match[3] ?? "").toLowerCase(), start, end: cursor };
}

export function insertSuggestion(text: string, trigger: ComposerTrigger, insert: string): string {
  if (!isOffset(trigger.start, text.length) || !isOffset(trigger.end, text.length) || trigger.start > trigger.end) {
    throw new RangeError("Suggestion span is outside the current draft.");
  }
  return `${text.slice(0, trigger.start)}${insert} ${text.slice(trigger.end).trimStart()}`;
}

export function composerSuggestions(trigger: ComposerTrigger, inventory: SuggestionInventory, conversations: Conversation[], hosts: HostInfo[]): ComposerSuggestion[] {
  assertTrigger(trigger);
  const rows: ComposerSuggestion[] = trigger.prefix === "/"
    ? inventory.commands.map(command => ({ id: `command:${command.name}`, label: `/${command.name}`, detail: command.description, insert: `/${command.name}` }))
    : [
      ...conversations.map(chat => ({ id: `chat:${chat.id}`, label: `@${chat.title}`, detail: `${chat.harness} · session`, insert: `@${chat.sessionId?.trim() ? chat.sessionId : chat.id}` })),
      ...hosts.flatMap(host => [
        ...(host.bots ?? []).map(bot => ({ id: `bot:${host.id}:${bot.id}`, label: `@${bot.name}`, detail: `${host.name} · bot`, insert: `@${bot.name}` })),
        ...host.agents.map(agent => ({ id: `agent:${host.id}:${agent.id}`, label: `@${agent.name}`, detail: `${host.name} · ${agent.kind}`, insert: `@${agent.name}` })),
      ]),
      ...inventory.files.filter(path => path.trim() !== "").map(path => ({ id: `file:${path}`, label: `@${path}`, detail: "Workspace file", insert: `@${path}` })),
    ];
  return rows.filter(row => `${row.label} ${row.detail}`.toLowerCase().includes(trigger.query)).slice(0, 30);
}
