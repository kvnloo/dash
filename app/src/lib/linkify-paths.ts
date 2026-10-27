/**
 * Convert bare web URLs and source paths in completed Markdown lines to links.
 *
 * This is a deliberately conservative pre-pass, not a Markdown renderer:
 * protected markup is copied verbatim and a final unterminated line is
 * deferred until whitespace arrives. No dependencies or filesystem access.
 */
const MAX_MARKDOWN_LENGTH = 200_000;
const CODE_TICK = "\u0060";

interface Fence {
  marker: string;
  width: number;
}

interface MarkdownBracket {
  phase: "label" | "destination" | "reference";
  depth: number;
  angleDestination: boolean;
}

interface ScanState {
  markdownBracket: MarkdownBracket | null;
  codeWidth: number;
  htmlComment: boolean;
  tagBuffer: string | null;
  tagQuote: string | null;
  htmlStack: string[];
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isWord(char: string | undefined): boolean {
  return char !== undefined &&
    ((char >= "A" && char <= "Z") ||
      (char >= "a" && char <= "z") ||
      (char >= "0" && char <= "9"));
}

function isEscaped(line: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function boundaryBefore(line: string, index: number): boolean {
  if (index === 0) return true;
  const previous = line[index - 1];
  return !isWord(previous) && previous !== "_" && previous !== "." &&
    previous !== "-" && previous !== "+" && previous !== "~" &&
    previous !== "/" && previous !== "@" && previous !== "\\";
}

function openingFence(line: string): Fence | null {
  let index = 0;
  while (index < 4 && line[index] === " ") index++;
  if (index > 3) return null;
  const marker = line[index];
  if (marker !== CODE_TICK && marker !== "~") return null;
  let end = index;
  while (line[end] === marker) end++;
  if (end - index < 3) return null;
  // A backtick fence's info string cannot itself contain a backtick.
  if (marker === CODE_TICK && line.slice(end).includes(CODE_TICK)) return null;
  return { marker, width: end - index };
}

function closesFence(line: string, fence: Fence): boolean {
  let index = 0;
  while (index < 4 && line[index] === " ") index++;
  if (index > 3 || line[index] !== fence.marker) return false;
  let end = index;
  while (line[end] === fence.marker) end++;
  return end - index >= fence.width && line.slice(end).trim() === "";
}

/** Keep all bracketed labels protected, including reference-style links. */
/**
 * Keep an existing Markdown link or image protected across line boundaries.
 * The parser consumes nested labels, reference labels, and destinations without
 * looking for bare URLs or paths inside any of those regions.
 */
function scanMarkdownBracket(line: string, start: number, state: ScanState): number {
  let index = start;
  while (index < line.length) {
    const bracket = state.markdownBracket;
    if (bracket === null) break;
    const char = line[index] ?? "";
    if (char === "\\") {
      index += 2; // Markdown escape: skip the escaped character.
      continue;
    }
    if (bracket.phase === "label") {
      if (char === "[") {
        bracket.depth++;
      } else if (char === "]" && --bracket.depth === 0) {
        if (line[index + 1] === "(") {
          bracket.phase = "destination";
          bracket.depth = 1;
          index += 2;
          continue;
        }
        if (line[index + 1] === "[") {
          bracket.phase = "reference";
          bracket.depth = 1;
          index += 2;
          continue;
        }
        state.markdownBracket = null;
      }
    } else if (bracket.phase === "reference") {
      if (char === "[") bracket.depth++;
      else if (char === "]" && --bracket.depth === 0) state.markdownBracket = null;
    } else if (bracket.angleDestination) {
      // Parentheses in a <destination> are literal, not Markdown delimiters.
      if (char === ">") bracket.angleDestination = false;
    } else if (char === "<" && bracket.depth === 1) {
      bracket.angleDestination = true;
    } else if (char === "(") {
      bracket.depth++;
    } else if (char === ")" && --bracket.depth === 0) {
      state.markdownBracket = null;
    }
    index++;
  }
  return index;
}

function recordHtmlTag(state: ScanState, tag: string): void {
  if (/^<\s*(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:)/i.test(tag)) return;
  const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/.exec(tag);
  if (!match) return; // Includes URL autolinks and email autolinks.
  const name = (match[2] ?? "").toLowerCase();
  if (match[1] === "/") {
    const position = state.htmlStack.lastIndexOf(name);
    if (position !== -1) state.htmlStack.splice(position);
  } else if (!/\/\s*>$/.test(tag) && !VOID_TAGS.has(name)) {
    state.htmlStack.push(name);
  }
}

/** Consume a tag, including attributes spanning multiple lines. */
function scanHtmlTag(line: string, offset: number, state: ScanState): number {
  let index = offset;
  while (index < line.length) {
    const char = line[index] ?? "";
    state.tagBuffer = (state.tagBuffer ?? "") + char;
    if (state.tagQuote !== null) {
      if (char === state.tagQuote) state.tagQuote = null;
    } else if (char === "'" || char === '"') {
      state.tagQuote = char;
    } else if (char === ">") {
      recordHtmlTag(state, state.tagBuffer ?? "");
      state.tagBuffer = null;
      state.tagQuote = null;
      return index + 1;
    }
    index++;
  }
  state.tagBuffer = (state.tagBuffer ?? "") + "\n";
  return index;
}

function urlEnd(line: string, start: number): number | null {
  const prefix = line.slice(start, start + 8).toLowerCase();
  const schemeLength = prefix.startsWith("https://") ? 8 :
    prefix.startsWith("http://") ? 7 : 0;
  if (schemeLength === 0) return null;

  let end = start + schemeLength;
  while (end < line.length) {
    const char = line[end] ?? "";
    if (/\s/.test(char) || "<>\"'\\\u0060[]{}".includes(char)) break;
    end++;
  }
  let opens = 0;
  let closes = 0;
  for (let index = start + schemeLength; index < end; index++) {
    if (line[index] === "(") opens++;
    else if (line[index] === ")") closes++;
  }
  let trimmed = end;
  while (trimmed > start + schemeLength) {
    const last = line[trimmed - 1];
    if (last === "." || last === "," || last === ";" || last === ":" ||
        last === "!" || last === "?") {
      trimmed--;
    } else if (last === ")" && closes > opens) {
      closes--;
      trimmed--;
    } else {
      break;
    }
  }
  const authority = line.slice(start + schemeLength, trimmed);
  if (!authority || authority.startsWith("/") || authority.startsWith(".")) return null;
  return trimmed;
}

/**
 * Unbalanced parentheses in a URL would terminate a Markdown destination
 * early, or swallow its generated closing delimiter. Escape them in the href
 * only; the visible link label and navigated URL keep the original characters.
 */
function markdownDestination(target: string): string {
  if (!/^https?:\/\//i.test(target)) return target;
  let depth = 0;
  let unbalanced = false;
  for (const char of target) {
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth > 0) depth--;
      else unbalanced = true;
    }
  }
  return unbalanced || depth > 0 ? target.replace(/[()]/g, "\\$&") : target;
}

function pathCharacter(char: string | undefined): boolean {
  return isWord(char) || char === "_" || char === "." || char === "-" ||
    char === "~" || char === "+" || char === "/";
}

function validPath(core: string): boolean {
  if (!core || core.endsWith("/") || core.includes("//")) return false;
  if (core.startsWith("/") || core.startsWith("~/") ||
      core.startsWith("./") || core.startsWith("../")) {
    const start = core.startsWith("../") ? 3 : core.startsWith("~/") ||
      core.startsWith("./") ? 2 : 1;
    return core.length > start && /[A-Za-z0-9]/.test(core.slice(start));
  }

  const slash = core.lastIndexOf("/");
  if (slash <= 0 || slash >= core.length - 1) return false;
  const filename = core.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return false;
  return /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(filename.slice(dot + 1));
}

function pathEnd(line: string, start: number): number | null {
  let end = start;
  while (pathCharacter(line[end])) end++;
  while (end > start && line[end - 1] === ".") end--;
  const core = line.slice(start, end);
  if (!validPath(core)) return null;

  if (line[end] === ":" && isDigit(line[end + 1])) {
    end++;
    while (isDigit(line[end])) end++;
    if (line[end] === ":" && isDigit(line[end + 1])) {
      end++;
      while (isDigit(line[end])) end++;
    }
  }
  return end;
}

function linkifyLine(line: string, state: ScanState): string {
  // Indented code and reference definitions are also kept verbatim.
  if (state.codeWidth === 0 && state.tagBuffer === null &&
      state.markdownBracket === null && !state.htmlComment &&
      state.htmlStack.length === 0 &&
      (line.startsWith("    ") || line.startsWith("\t") ||
        /^ {0,3}\[[^\]]+\]:/.test(line))) return line;

  const parts: string[] = [];
  let last = 0;
  let index = 0;
  while (index < line.length) {
    if (state.markdownBracket !== null) {
      index = scanMarkdownBracket(line, index, state);
      continue;
    }
    if (state.htmlComment) {
      const close = line.indexOf("-->", index);
      if (close === -1) break;
      state.htmlComment = false;
      index = close + 3;
      continue;
    }
    if (state.tagBuffer !== null) {
      index = scanHtmlTag(line, index, state);
      continue;
    }
    const char = line[index] ?? "";
    if (state.codeWidth > 0) {
      if (char === CODE_TICK && !isEscaped(line, index)) {
        let end = index;
        while (line[end] === CODE_TICK) end++;
        if (end - index === state.codeWidth) state.codeWidth = 0;
        index = end;
      } else {
        index++;
      }
      continue;
    }
    if (line.startsWith("<!--", index) && !isEscaped(line, index)) {
      state.htmlComment = true;
      index += 4;
      continue;
    }
    if (char === "<" && !isEscaped(line, index) &&
        /[A-Za-z/!?]/.test(line[index + 1] ?? "")) {
      state.tagBuffer = "";
      index = scanHtmlTag(line, index, state);
      continue;
    }
    if (state.htmlStack.length > 0) {
      index++;
      continue;
    }
    if (char === CODE_TICK && !isEscaped(line, index)) {
      let end = index;
      while (line[end] === CODE_TICK) end++;
      state.codeWidth = end - index;
      index = end;
      continue;
    }
    if ((char === "[" || (char === "!" && line[index + 1] === "[")) &&
        !isEscaped(line, index)) {
      const opening = char === "!" ? index + 1 : index;
      state.markdownBracket = { phase: "label", depth: 1, angleDestination: false };
      index = scanMarkdownBracket(line, opening + 1, state);
      continue;
    }

    if (boundaryBefore(line, index) && !isEscaped(line, index)) {
      const end = urlEnd(line, index) ?? pathEnd(line, index);
      if (end !== null && end > index) {
        const target = line.slice(index, end);
        const label = target.replace(/([\\[\]])/g, "\\$1");
        parts.push(line.slice(last, index), "[" + label + "](" + markdownDestination(target) + ")");
        index = end;
        last = end;
        continue;
      }
    }
    index++;
  }
  if (parts.length === 0) return line;
  parts.push(line.slice(last));
  return parts.join("");
}

/**
 * Linkify complete prose, preserving code/HTML/links and incomplete final
 * streaming lines. Re-running this function does not alter generated links.
 */
export function linkifyMarkdown(markdown: string): string {
  if (markdown.length > MAX_MARKDOWN_LENGTH) return markdown;
  const lines = markdown.split("\n");
  const state: ScanState = {
    codeWidth: 0, htmlComment: false, tagBuffer: null, tagQuote: null,
    htmlStack: [], markdownBracket: null,
  };
  let fence: Fence | null = null;
  const result: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      result.push(rawLine);
      continue;
    }
    if (state.codeWidth === 0 && !state.htmlComment &&
        state.tagBuffer === null && state.htmlStack.length === 0) {
      const opened = openingFence(line);
      if (opened !== null) {
        fence = opened;
        result.push(rawLine);
        continue;
      }
    }
    // A streaming tail can still grow into a longer path or URL.
    const complete = index < lines.length - 1 || /\s$/.test(rawLine);
    result.push(complete ? linkifyLine(rawLine, state) : rawLine);
  }
  return result.join("\n");
}
