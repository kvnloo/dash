/**
 * Pure, bounded log-signature watcher. No side effects, timers, network or file I/O.
 * The caller owns log collection, delivery, and the trust boundary for notices.
 */
export type LogSource = "bridge" | "app" | "device";

export type LogSignatureId =
  | "react-native-redbox"
  | "typeerror-undefined"
  | "unhandled-rejection"
  | "android-fatal-exception"
  | "android-anr"
  | "js-stack-overflow"
  | "bridge-eaddrinuse"
  | "bridge-econnrefused-burst"
  | "hermes-auth-burst"
  | "out-of-memory";

export interface LogNotice {
  /** Unique within a watch instance; not a protocol or globally persistent id. */
  id: string;
  signature: LogSignatureId;
  source: LogSource;
  firstAt: number;
  count: number;
  summary: string;
}

export interface LogWatchOptions {
  now?: () => number;
  windowMs?: number;
  maxNotices?: number;
}

export interface LogWatch {
  push(line: string, source: LogSource): LogNotice | null;
  flush(): LogNotice[];
}

type SignatureRule = {
  id: LogSignatureId;
  pattern: RegExp;
  /** Recurrent transport/auth failures require a burst before alerting. */
  threshold: number;
};

/** Ordered: specific runtime failures before broader transport or memory patterns. */
const SIGNATURES: readonly SignatureRule[] = [
  {
    id: "react-native-redbox",
    pattern: /\bInvariant Violation\b|\bRedBox\b|\b(?:React[\s-]*Native|ReactNativeJS)\b.*\bred[\s-]*box\b/i,
    threshold: 1,
  },
  {
    id: "typeerror-undefined",
    pattern: /\bTypeError:\s*undefined is not\b/i,
    threshold: 1,
  },
  {
    id: "unhandled-rejection",
    pattern: /\bunhandled(?:promise)?rejection(?:warning)?\b|\b(?:possible\s+)?unhandled\s+(?:promise\s+)?rejection\b/i,
    threshold: 1,
  },
  {
    id: "android-fatal-exception",
    pattern: /\bFATAL EXCEPTION\b/i,
    threshold: 1,
  },
  {
    id: "android-anr",
    pattern: /\bANR in\b/i,
    threshold: 1,
  },
  {
    id: "js-stack-overflow",
    pattern: /\bRangeError:\s*Maximum call stack\b/i,
    threshold: 1,
  },
  {
    id: "bridge-eaddrinuse",
    pattern: /\bEADDRINUSE\b/i,
    threshold: 1,
  },
  {
    id: "bridge-econnrefused-burst",
    pattern: /\bECONNREFUSED\b/i,
    threshold: 3,
  },
  {
    id: "hermes-auth-burst",
    pattern: /\b(?:Hermes|gateway|A2A)\b.*\b(?:401|403)\b|\b(?:401|403)\b.*\b(?:Hermes|gateway|A2A)\b/i,
    threshold: 3,
  },
  {
    id: "out-of-memory",
    pattern: /\bout[\s-]+of[\s-]+memory\b|\bOutOfMemoryError\b|\blowmemorykiller\b/i,
    threshold: 1,
  },
];

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FINGERPRINTS = 256;
const MAX_BUFFERED_NOTICES = 64;
const MAX_LINE_CHARS = 16_384;

type Seen = {
  firstAt: number;
  source: LogSource;
  summary: string;
  count: number;
  notice?: LogNotice;
};

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.trunc(value));
}

/** Keep file:line; discard absolute directories, call names, columns, and numeric ids. */
function firstFrame(line: string): string {
  const frame = /(?:\bat\s+(?:[^\s()]+\s*\()?|@)([^\s()]+):(\d+)(?::\d+)?\)?/i.exec(line);
  if (!frame) return "no-frame";
  const path = frame[1];
  const lineNumber = frame[2];
  if (!path || !lineNumber) return "no-frame";
  const file = path.split(/[\\/]/).pop()?.replace(/[?#].*$/, "").replace(/\d+/g, "#").toLowerCase();
  return file ? file + ":" + lineNumber : "no-frame";
}

/** Sanitize first, then truncate: never truncate halfway through an unredacted secret. */
function safeSummary(line: string): string {
  return line
    .replace(/\bBearer\s+["']?[^\s,;"']+["']?/gi, "Bearer [REDACTED]")
    .replace(/\b((?:access_|refresh_|auth_)?token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&;,]+)/gi, "$1=[REDACTED]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[REDACTED]")
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function createLogWatch(options: LogWatchOptions = {}): LogWatch {
  const now = options.now ?? Date.now;
  const windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS);
  const maxNotices = Math.min(MAX_BUFFERED_NOTICES, positiveInteger(options.maxNotices, MAX_BUFFERED_NOTICES));
  const seen = new Map<string, Seen>();
  const pending: LogNotice[] = [];
  let serial = 0;

  function touch(key: string, entry: Seen): void {
    seen.delete(key);
    seen.set(key, entry);
    if (seen.size > MAX_FINGERPRINTS) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  return {
    push(line, source) {
      const raw = line.slice(0, MAX_LINE_CHARS);
      const rule = SIGNATURES.find((candidate) => candidate.pattern.test(raw));
      if (!rule) return null;

      const instant = now();
      const at = Number.isFinite(instant) ? instant : Date.now();
      const fingerprint = rule.id + "|" + firstFrame(raw);
      let entry = seen.get(fingerprint);
      if (!entry || at < entry.firstAt || at - entry.firstAt >= windowMs) {
        entry = { firstAt: at, source, summary: safeSummary(raw), count: 0 };
      }

      entry.count++;
      touch(fingerprint, entry);
      if (entry.notice) {
        // The buffered notice reflects the latest count until flushed. No duplicate event.
        entry.notice.count = entry.count;
        return null;
      }
      if (entry.count < rule.threshold) return null;

      const notice: LogNotice = {
        id: "log-watch:" + rule.id + ":" + ++serial,
        signature: rule.id,
        source: entry.source,
        firstAt: entry.firstAt,
        count: entry.count,
        summary: entry.summary,
      };
      entry.notice = notice;
      pending.push(notice);
      if (pending.length > maxNotices) pending.shift();
      return { ...notice };
    },
    flush() {
      return pending.splice(0).map((notice) => ({ ...notice }));
    },
  };
}
