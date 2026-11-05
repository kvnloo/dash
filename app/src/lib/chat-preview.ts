import type { AssistantMessage, Conversation } from "../model";

export type ChatPreviewKind = "needs-you" | "failed" | "working" | "reply" | "you" | "empty";
export type ChatPreviewResult = { text: string; kind: ChatPreviewKind };
type PreviewConversation = Pick<Conversation, "messages" | "cwd" | "title" | "sessionId"> & { preview?: string };

const MAX_PREVIEW = 90;
const MAX_SCAN_CHARS = 16_384;

/** 90 UTF-16 code units maximum, with no chopped word at the end. */
function short(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= MAX_PREVIEW) return line;
  const prefix = line.slice(0, MAX_PREVIEW - 1).trimEnd();
  const boundary = prefix.lastIndexOf(" ");
  return (boundary > 0 ? prefix.slice(0, boundary).trimEnd() : "") + "…";
}

/** Remove only valid JSON objects; ordinary prose containing braces remains intact. */
function withoutJsonObjects(text: string): string {
  let result = "";
  let keptFrom = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const char = text[j];
      if (quoted) {
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === "{") depth += 1;
      if (char !== "}") continue;
      depth -= 1;
      if (depth !== 0) continue;
      const candidate = text.slice(i, j + 1);
      if (/^\{\s*"/.test(candidate)) {
        try {
          const parsed: unknown = JSON.parse(candidate);
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            result += text.slice(keptFrom, i) + " ";
            keptFrom = j + 1;
            i = j;
          }
        } catch {
          // Not JSON; leave user-visible prose intact.
        }
      }
      break;
    }
  }
  return result + text.slice(keptFrom);
}

function compactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>()]+/gi, (raw) => {
    const punctuation = /[.,!?;:]+$/.exec(raw)?.[0] ?? "";
    const address = punctuation ? raw.slice(0, -punctuation.length) : raw;
    if (address.length <= 40) return raw;
    const authority = /^https?:\/\/([^/?#]+)/i.exec(address)?.[1];
    if (!authority) return raw;
    const host = authority.split("@").at(-1);
    return (host || authority) + punctuation;
  });
}

/** Text-only, bounded markdown cleanup; no model calls, network calls or mutable caches. */
function readable(raw: string, reply: boolean): string {
  const lines: string[] = [];
  let fenceSymbol = "";
  let fenceLength = 0;
  for (const line of withoutJsonObjects(raw.slice(0, MAX_SCAN_CHARS)).split(/\r?\n/)) {
    const trimmed = line.trim();
    const fence = /^(\x60{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence) {
      if (!fenceLength) {
        fenceSymbol = fence[0] ?? "";
        fenceLength = fence.length;
      } else if (fence[0] === fenceSymbol && fence.length >= fenceLength && !trimmed.slice(fence.length).trim()) {
        fenceSymbol = "";
        fenceLength = 0;
      }
      continue;
    }
    if (fenceLength || /^(?: {4}|\t)/.test(line)) continue;
    if (reply && (/^#{1,6}\s/.test(trimmed) || /^>\s/.test(trimmed))) continue;
    const visible = trimmed.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "");
    if (reply && (/^(?:thinking|analyzing|working)(?:…|\.{2,3})?$/i.test(visible) ||
      /^(?:\$\s*|(?:bun|npm|pnpm|yarn|git|curl|cd)\s)/i.test(visible))) continue;
    if (visible) lines.push(visible);
  }
  const text = lines.join(" ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|~~|\x60/g, "")
    .replace(/^#{1,6}\s+/, "");
  return compactUrls(text).replace(/\s+/g, " ").trim();
}

function firstSentence(text: string): string {
  const end = /[.!?](?=\s|$)/.exec(text);
  return short(end ? text.slice(0, end.index + 1) : text);
}

function permissionNotice(message: AssistantMessage): string | undefined {
  const status = readable(message.status ?? "", false);
  if (/(?:\bclarification\s+(?:required|needed)\b|\b(?:waiting for|awaiting)\s+clarification\b|\buser input required\b)/i.test(status)) {
    const detail = status.split(/:\s*/).slice(1).join(": ").trim();
    return "Answer needed" + (detail ? " · " + detail : "");
  }
  if (/(?:\b(?:approval|permission)\s+(?:required|needed)\b|\b(?:waiting for|awaiting)\s+(?:approval|permission)\b|\bneeds?\s+(?:approval|permission)\b)/i.test(status)) {
    const detail = status.split(/:\s*/).slice(1).join(": ").trim();
    return "Approval needed" + (detail ? " · " + detail : "");
  }
  return undefined;
}

function workingNotice(message: AssistantMessage): string {
  if (message.handoff === "queued") return "Waiting for host";
  if (message.handoff === "sending") return "Sending to host";
  if (message.delivery === "queued" || message.delivery === "steered") return "Waiting to send";
  const status = readable(message.status?.trim() || message.activity?.at(-1) || "", false);
  const file = /(?:^|[\s/\\])([\w.-]+\.(?:tsx?|jsx?|json|md|py|css|html|ya?ml|go|rs|sh))\b/i.exec(status)?.[1];
  if (/\b(?:test|tests|testing|vitest|pytest|jest)\b/i.test(status) &&
      /\b(?:run|running|execute|executing|test|testing|bun|npm|pnpm|yarn)\b/i.test(status)) return "Running tests";
  if (/\b(?:edit|editing|update|updating|modify|modifying|patch|patching|writing file|applying patch)\b/i.test(status)) {
    return "Editing " + (file || "files");
  }
  if (/\b(?:read|reading|inspect|inspecting|opening)\b/i.test(status)) return "Reading " + (file || "files");
  if (/\b(?:search|searching|grep|grepping|finding)\b/i.test(status)) return "Searching files";
  if (/\b(?:build|building|bundle|bundling|compile|compiling)\b/i.test(status)) return "Building app";
  if (/\b(?:running|executing|command|shell|terminal)\b/i.test(status)) return "Running command";
  if (/\b(?:thinking|analyzing)\b/i.test(status)) return "Thinking through request";
  return message.state === "pending" ? "Waiting to start" : "Working on reply";
}

function fallback(c: PreviewConversation): string {
  const bridged = readable(c.preview ?? "", false);
  if (bridged) return short(bridged);
  const folder = c.cwd?.trim().replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
  if (folder) return short(readable(folder, false));
  return short(readable(c.title, false) || "Empty chat");
}

/**
 * A pure Chats-list preview. Reads at most the last six message slots:
 * unresolved requests and failed delivery outrank work, which outranks
 * the latest meaningful reply or user turn. No transcript-wide scan.
 * A failure or request older than a finished reply, and an assistant failure
 * followed by a newer assistant turn (a retry), is resolved and never shown.
 */
export function chatPreview(c: PreviewConversation): ChatPreviewResult {
  let needsYou: ChatPreviewResult | undefined;
  let failed: ChatPreviewResult | undefined;
  let working: ChatPreviewResult | undefined;
  let content: ChatPreviewResult | undefined;
  const first = Math.max(0, c.messages.length - 6);
  let settled = false;
  let newerTurn = false;
  for (let i = c.messages.length - 1; i >= first; i -= 1) {
    const message = c.messages[i];
    if (!message) continue;
    if (message.role === "user") {
      if (message.delivery === "failed" && !failed && !settled) {
        const reason = readable(message.deliveryNote ?? "", false) || "Delivery failed";
        failed = { text: short("Not sent · " + reason), kind: "failed" };
      }
      if (!content) {
        const detail = readable(message.text, false) || (message.attachments?.length ? "Attachment" : "Message");
        content = { text: short("You: " + detail), kind: "you" };
      }
      continue;
    }
    if (settled) continue;
    const retried = newerTurn;
    newerTurn = true;
    if (message.state === "pending" || message.state === "streaming") {
      if (!needsYou) {
        const notice = permissionNotice(message);
        if (notice) needsYou = { text: short(notice), kind: "needs-you" };
      }
      if (!working) working = { text: short(workingNotice(message)), kind: "working" };
    } else if (message.state === "error" || message.state === "interrupted") {
      if (!failed && !retried) {
        const reason = readable(message.error || message.status || "", false);
        const label = message.state === "interrupted" ? "Interrupted" : "Failed";
        failed = { text: short(label + (reason ? " · " + reason : " · Reply failed")), kind: "failed" };
      }
    } else {
      settled = true;
      if (!content) {
        const reply = firstSentence(readable(message.text, true));
        if (reply) content = { text: reply, kind: "reply" };
      }
    }
  }
  return needsYou ?? failed ?? working ?? content ?? { text: fallback(c), kind: "empty" };
}
