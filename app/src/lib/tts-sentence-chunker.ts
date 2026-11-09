/** Pure streaming Markdown-to-speech chunker. Make one instance per assistant reply. */
export interface SentenceChunkerOptions {
  maxWords?: number;
  minWords?: number;
}

export interface SentenceChunker {
  /** Return only newly completed, speakable chunks. */
  push(delta: string): string[];
  /** Finish a reply and reset parser state for possible reuse. */
  flush(): string[];
}

type CloseStage = "indent" | "marker" | "trailing" | "invalid";
type LinkStage = "text" | "label" | "after-label" | "target";

const codeTick = String.fromCharCode(96);
const wordCharacter = /[\p{L}\p{N}]/u;
const lowercase = /\p{Ll}/u;
const whitespace = /\s/u;
const abbreviation = /^(?:e\.g\.|i\.e\.|mr\.|mrs\.|dr\.|vs\.|etc\.)$/i;
const honorific = /^(?:mr\.|mrs\.|dr\.)$/i;
const closingMarks = "\"'”’)]}";

function cleanSpeech(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function countWords(text: string): number {
  const clean = cleanSpeech(text);
  if (!clean) return 0;
  return clean.split(" ").filter(word => wordCharacter.test(word)).length;
}

function sentenceEnd(text: string, minWords: number): { end: number; waiting: boolean } {
  for (let index = 0; index < text.length; index++) {
    const mark = text[index] ?? "";
    if (!".!?…".includes(mark)) continue;

    let end = index + 1;
    while (end < text.length && closingMarks.includes(text[end] ?? "")) end++;
    if (end >= text.length || !whitespace.test(text[end] ?? "")) continue;
    if (countWords(text.slice(0, end)) < minWords) continue;

    if (mark === ".") {
      const previous = text.slice(0, index + 1).match(/[^\s]+$/u)?.[0] ?? "";
      const token = previous.replace(/^[("'“‘\[]+/u, "");
      if (abbreviation.test(token)) {
        // A following lowercase word makes an abbreviation unambiguously
        // nonterminal. Hold this decision if the next word is still streaming.
        const next = text.slice(end).match(/[\p{L}\p{N}]/u)?.[0];
        if (!next) return { end: -1, waiting: true };
        if (honorific.test(token) || lowercase.test(next)) continue;
      }
    }
    return { end, waiting: false };
  }
  return { end: -1, waiting: false };
}

/** Only whitespace-terminated words are safe to hard-break during streaming. */
function maxWordEnd(text: string, maxWords: number): number {
  let count = 0;
  let inToken = false;
  let wordToken = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    if (whitespace.test(char)) {
      if (inToken && wordToken && ++count === maxWords) return index;
      inToken = false;
      wordToken = false;
    } else {
      inToken = true;
      if (wordCharacter.test(char)) wordToken = true;
    }
  }
  return -1;
}

/** Prefer the last pronounceable clause within the 24-word window. */
function clauseEnd(text: string, hardEnd: number, minWords: number): number {
  let end = hardEnd;
  for (let index = 0; index < hardEnd; index++) {
    if (!",;:".includes(text[index] ?? "")) continue;
    if (!whitespace.test(text[index + 1] ?? "")) continue;
    if (countWords(text.slice(0, index + 1)) >= minWords) end = index + 1;
  }
  return end;
}

function possibleFencePrefix(prefix: string): boolean {
  if (prefix.startsWith("    ")) return false;
  const run = prefix.trimStart();
  if (!run) return true;
  const marker = run[0] ?? "";
  return (marker === codeTick || marker === "~") &&
    [...run].every(char => char === marker);
}

function completeFencePrefix(prefix: string): boolean {
  const run = prefix.trimStart();
  return possibleFencePrefix(prefix) && run.length >= 3;
}

export function createSentenceChunker(
  { maxWords = 24, minWords = 2 }: SentenceChunkerOptions = {},
): SentenceChunker {
  if (!Number.isSafeInteger(maxWords) || !Number.isSafeInteger(minWords) ||
    minWords < 1 || maxWords < minWords) {
    throw new RangeError("Sentence chunker requires 1 <= minWords <= maxWords (integers).");
  }

  let pending = "";
  let atRawLineStart = true;
  let openingPrefix = "";
  let fenceMarker = "";
  let fenceWidth = 0;
  let openingFenceLine = false;
  let closeStage: CloseStage = "indent";
  let closeIndent = 0;
  let closeWidth = 0;

  let inlineCodeWidth = 0;
  let tickRun = 0;
  let atMarkdownLineStart = true;
  let linkStage: LinkStage = "text";
  let linkLabel = "";
  let linkDepth = 0;

  function emit(end: number, output: string[]): void {
    const chunk = cleanSpeech(pending.slice(0, end));
    pending = pending.slice(end).trimStart();
    if (chunk) output.push(chunk);
  }

  function drain(output: string[]): void {
    while (pending) {
      const sentence = sentenceEnd(pending, minWords);
      if (sentence.waiting) return;
      if (sentence.end >= 0) {
        emit(sentence.end, output);
        continue;
      }
      const hardEnd = maxWordEnd(pending, maxWords);
      if (hardEnd < 0) return;
      emit(clauseEnd(pending, hardEnd, minWords), output);
    }
  }

  function appendSpeech(char: string, output: string[]): void {
    pending += char;
    drain(output);
  }

  /** Strip emphasis/heading markers and code spans without leaking partial code. */
  function visibleChar(char: string, output: string[]): void {
    if (char === codeTick) {
      tickRun++;
      return;
    }
    if (tickRun) {
      if (inlineCodeWidth === 0) inlineCodeWidth = tickRun;
      else if (inlineCodeWidth === tickRun) inlineCodeWidth = 0;
      tickRun = 0;
    }
    if (inlineCodeWidth) return;
    if (char === "\n" || char === "\r") {
      atMarkdownLineStart = true;
      appendSpeech(" ", output);
      return;
    }
    if (char === "*" || char === "_") return;
    if (char === "#" && atMarkdownLineStart) return;
    if (char !== " " && char !== "\t") atMarkdownLineStart = false;
    appendSpeech(char, output);
  }

  function releaseLabel(output: string[]): void {
    const label = linkLabel;
    linkLabel = "";
    for (const char of label) visibleChar(char, output);
  }

  /** Defer bracketed text until it is known whether a link target follows. */
  function markdownChar(char: string, output: string[]): void {
    if (linkStage === "target") {
      if (char === "(") linkDepth++;
      else if (char === ")" && --linkDepth === 0) linkStage = "text";
      else if (char === "\n") {
        atMarkdownLineStart = true;
        appendSpeech(" ", output);
      }
      return;
    }
    if (linkStage === "label") {
      if (char === "]") linkStage = "after-label";
      else if (char === "\n") {
        linkStage = "text";
        releaseLabel(output);
        visibleChar("\n", output);
      } else linkLabel += char;
      return;
    }
    if (linkStage === "after-label") {
      if (char === "(") {
        linkStage = "target";
        linkDepth = 1;
        releaseLabel(output);
        return;
      }
      linkStage = "text";
      releaseLabel(output);
    }
    if (char === "[" && inlineCodeWidth === 0 && tickRun === 0) {
      linkStage = "label";
      linkLabel = "";
    } else {
      visibleChar(char, output);
    }
  }

  function resetClosingLine(): void {
    closeStage = "indent";
    closeIndent = 0;
    closeWidth = 0;
  }

  function beginFence(prefix: string, output: string[]): void {
    const run = prefix.trimStart();
    fenceMarker = run[0] ?? "";
    fenceWidth = run.length;
    openingFenceLine = true;
    resetClosingLine();
    // Separate prose on either side without ever appending fence contents.
    appendSpeech(" ", output);
  }

  /** Fenced contents, including partial/invalid closing lines, are discarded. */
  function fencedChar(char: string, output: string[]): void {
    if (char === "\n") {
      if (openingFenceLine) {
        openingFenceLine = false;
      } else if (closeStage === "trailing" ||
        (closeStage === "marker" && closeWidth >= fenceWidth)) {
        fenceMarker = "";
        fenceWidth = 0;
        markdownChar("\n", output);
      }
      resetClosingLine();
      atRawLineStart = true;
      return;
    }
    if (openingFenceLine || closeStage === "invalid") return;

    if (closeStage === "indent") {
      if (char === " " && closeIndent < 3) closeIndent++;
      else if (char === fenceMarker) {
        closeStage = "marker";
        closeWidth = 1;
      } else closeStage = "invalid";
    } else if (closeStage === "marker") {
      if (char === fenceMarker) closeWidth++;
      else if ((char === " " || char === "\t" || char === "\r") &&
        closeWidth >= fenceWidth) closeStage = "trailing";
      else closeStage = "invalid";
    } else if (closeStage === "trailing" &&
      char !== " " && char !== "\t" && char !== "\r") {
      closeStage = "invalid";
    }
  }

  /** Recognize a fence opener before any of its characters can reach speech. */
  function rawChar(char: string, output: string[]): void {
    if (fenceMarker) {
      fencedChar(char, output);
      return;
    }
    if (char === "\n") {
      if (completeFencePrefix(openingPrefix)) beginFence(openingPrefix, output);
      else for (const part of openingPrefix) markdownChar(part, output);
      openingPrefix = "";
      if (!fenceMarker) markdownChar("\n", output);
      else openingFenceLine = false;
      atRawLineStart = true;
      return;
    }
    if (!atRawLineStart) {
      markdownChar(char, output);
      return;
    }
    const probe = openingPrefix + char;
    if (possibleFencePrefix(probe)) {
      openingPrefix = probe;
      return;
    }
    if (completeFencePrefix(openingPrefix)) {
      beginFence(openingPrefix, output);
      openingPrefix = "";
      atRawLineStart = false;
      return; // The current char is part of the opening fence's info string.
    }
    for (const part of probe) markdownChar(part, output);
    openingPrefix = "";
    atRawLineStart = false;
  }

  function reset(): void {
    pending = "";
    atRawLineStart = true;
    openingPrefix = "";
    fenceMarker = "";
    fenceWidth = 0;
    openingFenceLine = false;
    resetClosingLine();
    inlineCodeWidth = 0;
    tickRun = 0;
    atMarkdownLineStart = true;
    linkStage = "text";
    linkLabel = "";
    linkDepth = 0;
  }

  return {
    push(delta: string): string[] {
      const output: string[] = [];
      for (const char of delta) rawChar(char, output);
      return output;
    },
    flush(): string[] {
      const output: string[] = [];
      if (!fenceMarker && !completeFencePrefix(openingPrefix)) {
        for (const char of openingPrefix) markdownChar(char, output);
      }
      if (linkStage === "label" || linkStage === "after-label") {
        releaseLabel(output);
      }
      const rest = cleanSpeech(pending);
      if (rest) output.push(rest);
      reset();
      return output;
    },
  };
}
