import { updateComposerDraft } from "../store/composer-drafts";

export interface SelectionRange { start: number; end: number }

/** Text shown in the selection sheet, without the common Markdown delimiters. */
export function readableReplyText(markdown: string): string {
  const visible: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) { fence = marker[0] ?? null; continue; }
      if (fence === marker[0]) { fence = null; continue; }
    }
    if (fence !== null) { visible.push(line); continue; }
    visible.push(line
      .replace(/^ {0,3}#{1,6} +/, "")
      .replace(/^ {0,3}> ?/, "")
      .replace(/^(\s*)(?:[-*+]|\d+\.) +/, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1"));
  }
  return visible.join("\n").trimEnd();
}

/** RN TextInput selection offsets and JS string slices both count UTF-16 units. */
export function selectedReplyText(source: string, selection: SelectionRange | null): string {
  if (!selection || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
    || selection.start < 0 || selection.end > source.length || selection.start >= selection.end) return "";
  return source.slice(selection.start, selection.end).trim();
}

export function appendReplyQuote(draft: string, excerpt: string): string {
  const selection = excerpt.replace(/\r\n?/g, "\n").trim();
  if (!selection) return draft;
  const quote = selection.split("\n").map(line => "> " + line.trimEnd()).join("\n");
  const divider = !draft || draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  return draft + divider + quote + "\n\n";
}

/** Writes only the unsent conversation draft; never dispatches a turn or changes attachments. */
export function replyToSelection(conversationId: string | null, source: string, selection: SelectionRange | null): boolean {
  if (!conversationId) return false;
  const excerpt = selectedReplyText(source, selection);
  if (!excerpt) return false;
  updateComposerDraft(conversationId, { text: "", attachments: [] }, draft => ({
    ...draft,
    text: appendReplyQuote(draft.text, excerpt),
  }));
  return true;
}
