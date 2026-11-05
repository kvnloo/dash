/**
 * Hide unfinished generative-UI fences from the Markdown parser.
 *
 * Markdown renderers may display an unterminated fence as literal source (or
 * render a complete JSON object before its closing fence has arrived). Replace
 * only that trailing, unclosed UI fence with an invalid, bounded placeholder.
 * GenerativeBlock already renders it as a native loading state while a turn
 * streams, and as an explicit invalid state after interruption.
 *
 * Closed fences and every unrelated code/prose span remain byte-for-byte intact.
 */
export function acceptsGeneration(current: number, incoming: number): boolean {
  return Number.isSafeInteger(incoming) && incoming >= 0 && incoming === current;
}

const openingFence = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/;
const closingFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

const placeholder = '{"__dash_pending_generated_ui__":true}';

function uiLanguage(info: string, flow: boolean): string | null {
  const normalized = info.trim().toLowerCase();
  const token = normalized.split(/\s+/)[0] ?? "";
  if (token === "genui" || token === "openui" || token === "openui-lang" || (flow && token === "html")) return token;

  // Language labels themselves arrive token-by-token. A prefix is only
  // provisional when it is the *whole* info string, not an unknown language.
  if (!token || normalized !== token) return null;
  for (const candidate of flow ? ["genui", "openui-lang", "openui", "html"] : ["genui", "openui-lang", "openui"]) {
    if (candidate.startsWith(token)) return candidate;
  }
  return null;
}

interface Fence {
  start: number;
  indent: string;
  marker: string;
  width: number;
  language: string | null;
}

/** Keep a partial UI payload invisible until its matching Markdown fence ends. */
export function prepareGenerativeMarkdown(markdown: string, flow = false): string {
  let open: Fence | null = null;
  let offset = 0;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (open) {
      const closing = closingFence.exec(line);
      if (closing && closing[1]?.charAt(0) === open.marker && (closing[1]?.length ?? 0) >= open.width) {
        open = null;
      }
    } else {
      const opening = openingFence.exec(line);
      if (opening) {
        const marker = opening[2] ?? "";
        open = {
          start: offset,
          indent: opening[1] ?? "",
          marker: marker.charAt(0),
          width: marker.length,
          language: uiLanguage(opening[3] ?? "", flow),
        };
      }
    }
    offset += rawLine.length + 1;
  }

  if (!open || !open.language) return markdown;
  const fence = open.marker.repeat(open.width);
  return markdown.slice(0, open.start) + open.indent + fence + open.language +
    "\n" + placeholder + "\n" + open.indent + fence;
}
