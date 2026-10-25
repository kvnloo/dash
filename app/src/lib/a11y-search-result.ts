import type { SearchResult } from "./global-search";

export const SEARCH_RESULT_KIND_LABEL: Record<SearchResult["kind"], string> = {
  bot: "Bot",
  conversation: "Chat",
  product: "Product",
  harness: "Harness",
  skill: "Skill",
  plugin: "Plugin",
  tool: "Tool",
  file: "File",
};

export interface SearchResultAccessibility {
  label: string;
  hint: string;
  state: { disabled: boolean };
  actions: { name: "activate" | "longpress"; label: string }[];
}

function updatedLabel(meta: string): string {
  if (meta === "now") return "Updated just now";
  const age = /^(\d+)([mhd])$/.exec(meta);
  if (!age) return "Updated " + meta;
  const count = Number(age[1]);
  const unit = age[2] === "m" ? "minute" : age[2] === "h" ? "hour" : "day";
  return "Updated " + count + " " + unit + (count === 1 ? "" : "s") + " ago";
}

function statusLabel(item: SearchResult, meta: string | null): string | undefined {
  if (item.kind === "bot") return item.bot.status === "running" ? "Running" : "Not running";
  if (item.kind === "harness") return item.available ? "Available" : "Unavailable";
  if (item.kind === "conversation") {
    if ("stale" in item.conversation && item.conversation.stale === true) return "Ended";
    return meta ? updatedLabel(meta) : undefined;
  }
  if (item.kind === "product") return meta ? updatedLabel(meta) : undefined;
  return undefined;
}

function targetLabel(item: SearchResult): string | undefined {
  if (item.kind === "bot") {
    if (!item.target) return "Chat unavailable in Dash";
    return item.target.online ? "Chat target online" : "Chat target offline";
  }
  if (item.kind === "harness" && !item.available) return "Not installed on laptop";
  return undefined;
}

function actionHint(item: SearchResult): string {
  switch (item.kind) {
    case "bot":
      if (!item.target) return "Shows bot information; Dash cannot open its chat";
      return item.target.online ? "Opens the bot chat" : "Attempts to open the bot chat; its target is offline";
    case "conversation":
      return "Opens the conversation";
    case "product":
      return "Opens orchestra details";
    case "harness":
      return item.available ? "Opens a harness chat" : "Opens the chat view; this harness is unavailable";
    case "skill":
      return "Opens OMP with a prefilled skill request";
    case "plugin":
      return "Opens OMP with a prefilled plugin request";
    case "tool":
      return "Opens OMP with a prefilled tool request";
    case "file":
      return "Opens OMP with a prefilled file request";
  }
}

/** Spoken result metadata; an offline or unaddressable result is still a clickable row. */
export function searchResultAccessibility(
  item: SearchResult,
  display: { title: string; meta: string | null; hasLongPress: boolean },
): SearchResultAccessibility {
  const kind = SEARCH_RESULT_KIND_LABEL[item.kind];
  const title = display.title.trim() || "Unnamed " + kind.toLowerCase();
  const parts: string[] = [];
  for (const value of [title, kind, statusLabel(item, display.meta), targetLabel(item), item.subtitle]) {
    const text = value?.trim();
    if (text && !parts.some((part) => part.toLowerCase() === text.toLowerCase())) parts.push(text);
  }
  const actions: SearchResultAccessibility["actions"] = [{ name: "activate", label: "Open result" }];
  if (display.hasLongPress) actions.push({ name: "longpress", label: "Send feedback" });
  return { label: parts.join(", "), hint: actionHint(item), state: { disabled: false }, actions };
}

/** Both native touch and TalkBack actions must dispatch the identical result identity. */
export function performSearchResultAction(
  item: SearchResult,
  actionName: string,
  onPress: (item: SearchResult) => void,
  onLongPress?: (item: SearchResult) => void,
): boolean {
  if (actionName === "activate") {
    onPress(item);
    return true;
  }
  if (actionName === "longpress" && onLongPress) {
    onLongPress(item);
    return true;
  }
  return false;
}
