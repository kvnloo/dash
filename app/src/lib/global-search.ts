import { DEMO_BOT_PROFILES, type BotProfile } from "../mock/bots";
import { loadAodlOrchestras, type OrchestraProject } from "../catalog/orchestra";
import {
  DEMO_FILES,
  DEMO_PLUGINS,
  DEMO_SKILLS,
  DEMO_TOOLS,
  type FileResource,
  type NamedResource,
} from "../mock/resources";
import { conversationPreview, findLiveConversation, mergeLiveConversations } from "./live-sessions";
import type { Conversation } from "../model";
import type { HostInfo } from "../../../shared/protocol";

export type MentionScope = "bots" | "conversation" | "product";
export type SlashScope = "live" | "harness" | "skill" | "plugin" | "tool" | "file";

export type SearchMode = "discover" | "mention" | "slash";

export type ParsedSearchQuery =
  | { mode: "discover"; text: string }
  | { mode: "mention"; scope: MentionScope | "unknown"; rawScope: string; text: string }
  | { mode: "slash"; scope: SlashScope | "unknown"; rawScope: string; text: string };

const MENTION_ALIASES: Record<string, MentionScope> = {
  bots: "bots",
  bot: "bots",
  conversation: "conversation",
  conversations: "conversation",
  converastion: "conversation",
  chat: "conversation",
  chats: "conversation",
  product: "product",
  products: "product",
  orchestra: "product",
};

const SLASH_ALIASES: Record<string, SlashScope> = {
  live: "live",
  harness: "harness",
  harnesses: "harness",
  skill: "skill",
  skills: "skill",
  plugin: "plugin",
  plugins: "plugin",
  tool: "tool",
  tools: "tool",
  file: "file",
  files: "file",
};

export const MENTION_SCOPES: { scope: MentionScope; label: string }[] = [
  { scope: "bots", label: "@bots" },
  { scope: "conversation", label: "@conversation" },
  { scope: "product", label: "@product" },
];

export const SLASH_SCOPES: { scope: SlashScope; label: string }[] = [
  { scope: "live", label: "/live" },
  { scope: "harness", label: "/harness" },
  { scope: "skill", label: "/skill" },
  { scope: "plugin", label: "/plugin" },
  { scope: "tool", label: "/tool" },
  { scope: "file", label: "/file" },
];

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const trimmed = raw.trim();
  const mention = trimmed.match(/^@(\w+)\s*(.*)$/s);
  if (mention?.[1]) {
    const rawScope = mention[1].toLowerCase();
    const scope = MENTION_ALIASES[rawScope] ?? "unknown";
    return { mode: "mention", scope, rawScope, text: (mention[2] ?? "").trim().toLowerCase() };
  }
  const slash = trimmed.match(/^\/(\w+)\s*(.*)$/s);
  if (slash?.[1]) {
    const rawScope = slash[1].toLowerCase();
    const scope = SLASH_ALIASES[rawScope] ?? "unknown";
    return { mode: "slash", scope, rawScope, text: (slash[2] ?? "").trim().toLowerCase() };
  }
  return { mode: "discover", text: trimmed.toLowerCase() };
}

export function scopeLabel(scope: MentionScope | SlashScope): string {
  return (
    MENTION_SCOPES.find((m) => m.scope === scope)?.label ??
    SLASH_SCOPES.find((s) => s.scope === scope)?.label ??
    `@${scope}`
  );
}

export function filterScopeSuggestions(query: string): { prefix: "@" | "/"; label: string; scope: string }[] {
  const trimmed = query.trim();
  const mentionPartial = trimmed.match(/^@(\w*)$/);
  if (mentionPartial) {
    const partial = (mentionPartial[1] ?? "").toLowerCase();
    return MENTION_SCOPES.filter(({ scope, label }) => !partial || scope.startsWith(partial) || label.includes(partial)).map(
      ({ scope, label }) => ({ prefix: "@", label, scope }),
    );
  }
  const slashPartial = trimmed.match(/^\/(\w*)$/);
  if (slashPartial) {
    const partial = (slashPartial[1] ?? "").toLowerCase();
    return SLASH_SCOPES.filter(({ scope, label }) => !partial || scope.startsWith(partial) || label.includes(partial)).map(
      ({ scope, label }) => ({ prefix: "/", label, scope }),
    );
  }
  return [];
}

export function formatSearchHint(parsed: ParsedSearchQuery): string | null {
  if (parsed.mode === "discover" && !parsed.text) return "Recent bots, chats, and products";
  if (parsed.mode === "discover") return `Matching “${parsed.text}” on Dash`;
  if (parsed.scope === "unknown") {
    return parsed.mode === "mention"
      ? `Unknown @${parsed.rawScope} · try @bots @conversation @product`
      : `Unknown /${parsed.rawScope} · try /live /harness /skill /file`;
  }
  const label = scopeLabel(parsed.scope);
  if (!parsed.text) {
    const noun =
      parsed.scope === "conversation"
        ? "conversations"
        : parsed.scope === "product"
          ? "products"
          : parsed.scope === "live"
            ? "live sessions"
            : `${parsed.scope}s`;
    return `${label} · all ${noun}`;
  }
  return `${label} · “${parsed.text}”`;
}

export function applyScopePrefix(current: string, label: string): string {
  const trimmed = current.trim();
  const rest = trimmed.match(/^[@/]\w+\s*(.*)$/s)?.[1]?.trim() ?? trimmed;
  return rest ? `${label} ${rest}` : `${label} `;
}

export type SearchResult =
  | { kind: "bot"; key: string; profile: BotProfile; subtitle: string }
  | { kind: "conversation"; key: string; conversation: Conversation; harnessName: string; subtitle: string }
  | { kind: "product"; key: string; project: OrchestraProject; subtitle: string }
  | { kind: "harness"; key: string; id: string; name: string; available: boolean; subtitle: string }
  | { kind: "skill"; key: string; skill: NamedResource; subtitle: string }
  | { kind: "plugin"; key: string; plugin: NamedResource; subtitle: string }
  | { kind: "tool"; key: string; tool: NamedResource; subtitle: string }
  | { kind: "file"; key: string; file: FileResource; subtitle: string };

function matches(text: string, haystack: string): boolean {
  if (!text) return true;
  return haystack.toLowerCase().includes(text);
}

export { conversationPreview } from "./live-sessions";

export function enrichProducts(conversations: Conversation[], orchestras: OrchestraProject[]): OrchestraProject[] {
  if (conversations.length === 0) return orchestras;
  return orchestras.map((p) => ({
    ...p,
    chatIds: conversations.filter((c) => p.agents.includes(c.harness)).map((c) => c.id),
  }));
}

const DISCOVER_LIMITS = { conversation: 8, bot: 6, product: 4 } as const;

export function runGlobalSearch(params: {
  query: string;
  conversations: Conversation[];
  harnesses: { id: string; name: string; available?: boolean }[];
  botProfiles?: BotProfile[];
  products?: OrchestraProject[];
  hosts?: HostInfo[];
}): SearchResult[] {
  const parsed = parseSearchQuery(params.query);
  const bots = params.botProfiles ?? DEMO_BOT_PROFILES;
  const products = params.products ?? enrichProducts(params.conversations, loadAodlOrchestras());
  const results: SearchResult[] = [];
  const discoverEmpty = parsed.mode === "discover" && !parsed.text;

  if (parsed.mode === "discover" || (parsed.mode === "mention" && parsed.scope === "bots")) {
    const ranked = [...bots].sort((a, b) => Number(b.online) - Number(a.online));
    let count = 0;
    for (const profile of ranked) {
      const harness = params.harnesses.find((h) => h.id === profile.harness);
      const hay = [profile.name, profile.role, profile.description, profile.harness, harness?.name ?? ""].join(" ");
      if (!matches(parsed.mode === "discover" ? parsed.text : parsed.text, hay)) continue;
      results.push({ kind: "bot", key: `bot:${profile.id}`, profile, subtitle: profile.role });
      count += 1;
      if (discoverEmpty && count >= DISCOVER_LIMITS.bot) break;
    }
  }

  if (parsed.mode === "discover" || (parsed.mode === "mention" && parsed.scope === "conversation")) {
    const sorted = [...params.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    let count = 0;
    for (const c of sorted) {
      const harnessName = params.harnesses.find((h) => h.id === c.harness)?.name ?? c.harness;
      const preview = conversationPreview(c);
      const hay = [c.title, harnessName, preview, c.harness].join(" ");
      if (!matches(parsed.mode === "discover" ? parsed.text : parsed.text, hay)) continue;
      results.push({ kind: "conversation", key: `conv:${c.id}`, conversation: c, harnessName, subtitle: preview });
      count += 1;
      if (discoverEmpty && count >= DISCOVER_LIMITS.conversation) break;
    }
  }

  if (parsed.mode === "discover" || (parsed.mode === "mention" && parsed.scope === "product")) {
    const sorted = [...products].sort((a, b) => b.updatedAt - a.updatedAt);
    let count = 0;
    for (const p of sorted) {
      const hay = [p.name, p.subtitle, p.agents.join(" "), p.status].join(" ");
      if (!matches(parsed.mode === "discover" ? parsed.text : parsed.text, hay)) continue;
      results.push({ kind: "product", key: `prod:${p.id}`, project: p, subtitle: p.subtitle });
      count += 1;
      if (discoverEmpty && count >= DISCOVER_LIMITS.product) break;
    }
  }

  if (parsed.mode === "slash" && parsed.scope === "live") {
    const listed = mergeLiveConversations([], params.hosts ?? [], Date.now());
    for (const live of listed) {
      const conversation = findLiveConversation(params.conversations, live) ?? live;
      const harnessName = params.harnesses.find((h) => h.id === conversation.harness)?.name ?? conversation.harness;
      const preview = conversationPreview(conversation);
      const hay = [conversation.title, harnessName, preview, conversation.harness, conversation.sessionId ?? "", conversation.cwd ?? ""].join(" ");
      if (!matches(parsed.text, hay)) continue;
      results.push({
        kind: "conversation",
        key: `live:${conversation.id}`,
        conversation,
        harnessName,
        subtitle: preview,
      });
    }
  }

  if (parsed.mode === "slash" && parsed.scope === "harness") {
    for (const h of params.harnesses) {
      const hay = [h.id, h.name, h.available ? "available online" : "offline unavailable"].join(" ");
      if (matches(parsed.text, hay)) {
        results.push({
          kind: "harness",
          key: `harness:${h.id}`,
          id: h.id,
          name: h.name,
          available: h.available !== false,
          subtitle: h.available !== false ? "Available on bridge" : "Not installed on laptop",
        });
      }
    }
  }

  if (parsed.mode === "slash" && parsed.scope === "skill") {
    for (const skill of DEMO_SKILLS) {
      const hay = [skill.name, skill.description, skill.harness ?? ""].join(" ");
      if (matches(parsed.text, hay)) {
        results.push({ kind: "skill", key: `skill:${skill.id}`, skill, subtitle: skill.description });
      }
    }
  }

  if (parsed.mode === "slash" && parsed.scope === "plugin") {
    for (const plugin of DEMO_PLUGINS) {
      const hay = [plugin.name, plugin.description, plugin.harness ?? ""].join(" ");
      if (matches(parsed.text, hay)) {
        results.push({ kind: "plugin", key: `plugin:${plugin.id}`, plugin, subtitle: plugin.description });
      }
    }
  }

  if (parsed.mode === "slash" && parsed.scope === "tool") {
    for (const tool of DEMO_TOOLS) {
      const hay = [tool.name, tool.description, tool.harness ?? ""].join(" ");
      if (matches(parsed.text, hay)) {
        results.push({ kind: "tool", key: `tool:${tool.id}`, tool, subtitle: tool.description });
      }
    }
  }

  if (parsed.mode === "slash" && parsed.scope === "file") {
    for (const file of DEMO_FILES) {
      const hay = [file.path, file.description].join(" ");
      if (matches(parsed.text, hay)) {
        results.push({ kind: "file", key: `file:${file.id}`, file, subtitle: file.description });
      }
    }
  }

  if (discoverEmpty) {
    const order: SearchResult["kind"][] = ["conversation", "bot", "product"];
    results.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }

  return results;
}
