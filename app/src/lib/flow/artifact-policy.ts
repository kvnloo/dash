/**
 * Pure, conservative pre-swap policy for fx0 HTML. The WebView/iframe must also
 * enforce navigation denial and its own sandbox; string checks are not a JS sandbox.
 */
export interface ArtifactPolicyOptions {
  readonly maxBytes?: number;
  readonly staticOnly?: boolean;
}

export interface ArtifactViolation {
  readonly rule: string;
  readonly excerpt: string;
}

export interface ArtifactPolicyResult {
  readonly ok: boolean;
  readonly violations: ArtifactViolation[];
}

export const ARTIFACT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const MAX_BYTES = 512 * 1024;
const CSP_META = '<meta http-equiv="Content-Security-Policy" content="' + ARTIFACT_CSP + '">';
const ATTRIBUTES = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
const CSS_IMPORT = /@import\s*(?:url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)|"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const URL_ATTRIBUTES = new Set(["src", "href", "action", "formaction", "srcset", "poster", "xlink:href"]);

interface Attribute {
  readonly name: string;
  readonly value: string | null;
  readonly raw: string;
}

interface HtmlTag {
  readonly name: string;
  readonly attributes: readonly Attribute[];
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

function utf8Bytes(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) count++;
    else if (code < 0x800) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        count += 4;
        i++;
      } else count += 3;
    } else count += 3;
  }
  return count;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", colon: ":", sol: "/", tab: "\t", newline: "\n",
    quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0",
  };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|colon|sol|tab|newline|quot|apos|lt|gt|nbsp);?/gi, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([^\r\n\f]))/gi, (_whole, digits: string | undefined, literal: string | undefined) => {
    if (!digits) return literal ?? "";
    const point = Number.parseInt(digits, 16);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd";
  }).replace(/\\(?:\r\n|\r|\n|\f)/g, "");
}

function compactUrl(value: string): string {
  return decodeCssEscapes(decodeEntities(value))
    .replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
}

function isRemoteUrl(value: string): boolean {
  return /^(?:(?:https?|wss?):|\/\/)/i.test(compactUrl(value));
}

function isRemoteSrcset(value: string): boolean {
  // Do not mistake the two slashes at the start of a base64 data image for a host.
  const withoutEmbeddedData = compactUrl(value).replace(/data:[^,\s]+,[a-z0-9+/_=-]+/gi, "data:embedded");
  return /(?:https?|wss?):/i.test(withoutEmbeddedData) || /(?:^|,)\/\//.test(withoutEmbeddedData);
}

function parseAttributes(source: string): Attribute[] {
  const found: Attribute[] = [];
  for (const match of source.matchAll(ATTRIBUTES)) {
    if (!match[1]) continue;
    found.push({
      name: match[1].toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? null,
      raw: match[0],
    });
  }
  return found;
}

function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') quote = char;
    else if (char === ">") return i;
  }
  return -1;
}

/** Scan opening tags while skipping comments and script/style text. */
function* openingTags(html: string): Generator<HtmlTag> {
  const lower = html.toLowerCase();
  const namePattern = /[a-z][a-z0-9:-]*/iy;
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const close = html.indexOf("-->", start + 4);
      cursor = close < 0 ? html.length : close + 3;
      continue;
    }
    namePattern.lastIndex = start + 1;
    const match = namePattern.exec(html);
    if (!match) {
      cursor = start + 1;
      continue;
    }
    const name = match[0].toLowerCase();
    const endMarker = tagEnd(html, start + 1 + match[0].length);
    if (endMarker < 0) break;
    const end = endMarker + 1;
    let content = "";
    cursor = end;
    if (name === "script" || name === "style") {
      const closing = lower.indexOf("</" + name, end);
      content = html.slice(end, closing < 0 ? html.length : closing);
      cursor = closing < 0 ? html.length : closing;
    }
    yield {
      name, attributes: parseAttributes(html.slice(start + 1 + match[0].length, endMarker)),
      raw: html.slice(start, end), start, end, content,
    };
  }
}

function snippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

const SCRIPT_RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: "script-window-open", pattern: /\bwindow\s*(?:\.\s*open|\[\s*["']open["']\s*\])\s*\(/i },
  { rule: "script-location", pattern: /\blocation\s*(?:(?:\.\s*href|\[\s*["']href["']\s*\])\s*=(?!=)|=(?!=)|\.\s*(?:assign|replace)\s*\()/i },
  { rule: "script-fetch", pattern: /\bfetch\s*\(/i },
  { rule: "script-xmlhttprequest", pattern: /\bXMLHttpRequest\b/i },
  { rule: "script-websocket", pattern: /\bWebSocket\b/i },
  { rule: "script-eventsource", pattern: /\bEventSource\b/i },
  { rule: "script-sendbeacon", pattern: /\bnavigator\s*(?:\.\s*sendBeacon|\[\s*["']sendBeacon["']\s*\])\s*\(/i },
];

export function checkArtifactHtml(html: string, options: ArtifactPolicyOptions = {}): ArtifactPolicyResult {
  const violations: ArtifactViolation[] = [];
  const add = (rule: string, excerpt: string) => {
    violations.push({ rule, excerpt: snippet(excerpt) });
  };
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) add("invalid-max-bytes", String(maxBytes));
  else {
    const bytes = utf8Bytes(html);
    if (bytes > maxBytes) add("size", String(bytes) + " bytes > " + String(maxBytes) + " bytes");
  }

  const scanScript = (code: string) => {
    for (const { rule, pattern } of SCRIPT_RULES) {
      const match = pattern.exec(code);
      if (match) add(rule, code.slice(Math.max(0, match.index - 24), match.index + match[0].length + 24));
    }
  };
  const scanCss = (source: string) => {
    const css = decodeCssEscapes(source);
    const imports = Array.from(css.matchAll(CSS_IMPORT));
    for (const match of imports) {
      const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
      if (isRemoteUrl(value)) add("remote-css-import", match[0]);
    }
    for (const match of css.matchAll(CSS_URL)) {
      const at = match.index ?? -1;
      if (imports.some(entry => at >= (entry.index ?? 0) && at < (entry.index ?? 0) + entry[0].length)) continue;
      if (isRemoteUrl(match[1] ?? match[2] ?? match[3] ?? "")) add("remote-css-url", match[0]);
    }
  };

  for (const tag of openingTags(html)) {
    if (tag.name === "base") add("base-tag", tag.raw);
    if (tag.name === "meta" && tag.attributes.some(a => a.name === "http-equiv" && decodeEntities(a.value ?? "").trim().toLowerCase() === "refresh")) {
      add("meta-refresh", tag.raw);
    }
    if (["iframe", "object", "embed"].includes(tag.name) && tag.attributes.some(a => a.name === "src")) {
      add(tag.name + "-src", tag.raw);
    }
    if (tag.name === "script") {
      if (options.staticOnly) add("static-script", tag.raw);
      scanScript(tag.content);
    }
    if (tag.name === "style") scanCss(tag.content);
    for (const attr of tag.attributes) {
      if (options.staticOnly && /^on[a-z]/i.test(attr.name) && attr.value !== null) {
        add("static-event-handler", attr.raw);
      }
      if (/^on[a-z]/i.test(attr.name) && attr.value !== null) scanScript(decodeEntities(attr.value));
      if (attr.name === "style" && attr.value !== null) scanCss(decodeEntities(attr.value));
      if (URL_ATTRIBUTES.has(attr.name) && attr.value !== null) {
        const value = decodeEntities(attr.value);
        if (attr.name === "srcset" ? isRemoteSrcset(value) : isRemoteUrl(value)) {
          add("remote-" + attr.name, attr.raw);
        }
        if (/^(?:javascript|vbscript):/i.test(compactUrl(value))) {
          add("scripted-url", attr.raw);
          scanScript(value);
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Remove every supplied CSP meta, then insert ours as the first child of head.
 * Calling this twice produces identical bytes; no DOM or platform dependency.
 */
export function withStrictCsp(html: string): string {
  const oldCspTags = Array.from(openingTags(html)).filter(tag =>
    tag.name === "meta" && tag.attributes.some(attr =>
      attr.name === "http-equiv" && /^content-security-policy(?:-report-only)?$/i.test(decodeEntities(attr.value ?? "").trim()),
    ),
  );
  let cleaned = html;
  for (const tag of oldCspTags.reverse()) {
    cleaned = cleaned.slice(0, tag.start) + cleaned.slice(tag.end);
  }

  const tags = Array.from(openingTags(cleaned));
  const head = tags.find(tag => tag.name === "head");
  if (head) return cleaned.slice(0, head.end) + CSP_META + cleaned.slice(head.end);

  const root = tags.find(tag => tag.name === "html");
  if (root) return cleaned.slice(0, root.end) + "<head>" + CSP_META + "</head>" + cleaned.slice(root.end);

  const doctype = /^\s*<!doctype\s+html\s*>/i.exec(cleaned);
  const at = doctype?.[0].length ?? 0;
  return cleaned.slice(0, at) + "<head>" + CSP_META + "</head>" + cleaned.slice(at);
}
