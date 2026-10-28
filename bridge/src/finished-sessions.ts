import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentInfo } from "../../shared/protocol";

export interface FsPort {
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number; isDirectory: boolean; size: number }>;
  readHead(path: string, maxBytes: number): Promise<string>;
}

export interface FinishedSessionsInput {
  fs: FsPort;
  homeDir: string;
  now: number;
  limitPerHarness?: number;
  maxAgeDays?: number;
}

type Kind = "codex" | "claude";
type FileCandidate = { path: string; sessionId: string; mtimeMs: number };

const HEAD_BYTES = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODEX_FILE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([A-Za-z0-9][A-Za-z0-9_-]*)\.jsonl$/;
const CLAUDE_FILE = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.jsonl$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." &&
    !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

async function safeReadDir(fs: FsPort, path: string): Promise<string[]> {
  try {
    return (await fs.readdir(path)).filter(safeSegment).sort();
  } catch {
    return [];
  }
}

async function candidate(
  fs: FsPort,
  path: string,
  sessionId: string,
  cutoff: number,
): Promise<FileCandidate | null> {
  try {
    const info = await fs.stat(path);
    if (info.isDirectory || !Number.isFinite(info.mtimeMs) || info.mtimeMs < cutoff) return null;
    return { path, sessionId, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

async function codexFiles(fs: FsPort, homeDir: string, cutoff: number): Promise<FileCandidate[]> {
  const root = join(homeDir, ".codex", "sessions");
  const files: FileCandidate[] = [];
  for (const year of await safeReadDir(fs, root)) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = join(root, year);
    for (const month of await safeReadDir(fs, yearDir)) {
      if (!/^(0[1-9]|1[0-2])$/.test(month)) continue;
      const monthDir = join(yearDir, month);
      for (const day of await safeReadDir(fs, monthDir)) {
        if (!/^(0[1-9]|[12]\d|3[01])$/.test(day)) continue;
        const dayDir = join(monthDir, day);
        for (const file of await safeReadDir(fs, dayDir)) {
          const match = CODEX_FILE.exec(file);
          if (!match?.[1]) continue;
          const item = await candidate(fs, join(dayDir, file), match[1], cutoff);
          if (item) files.push(item);
        }
      }
    }
  }
  return newestFirst(files);
}

async function claudeFiles(fs: FsPort, homeDir: string, cutoff: number): Promise<FileCandidate[]> {
  const root = join(homeDir, ".claude", "projects");
  const files: FileCandidate[] = [];
  for (const slug of await safeReadDir(fs, root)) {
    for (const file of await safeReadDir(fs, join(root, slug))) {
      const match = CLAUDE_FILE.exec(file);
      if (!match?.[1]) continue;
      const item = await candidate(fs, join(root, slug, file), match[1], cutoff);
      if (item) files.push(item);
    }
  }
  return newestFirst(files);
}

function newestFirst(files: FileCandidate[]): FileCandidate[] {
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path));
}

function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const item of content) {
    if (isRecord(item) && (item.type === "text" || item.type === "input_text") &&
      typeof item.text === "string" && item.text.trim()) return item.text;
  }
  return "";
}

function userText(record: Record<string, unknown>, kind: Kind): string {
  if (kind === "codex") {
    const payload = record.payload;
    if (!isRecord(payload)) return "";
    if (record.type === "event_msg" && payload.type === "user_message" &&
      typeof payload.message === "string") return payload.message;
    if (record.type === "response_item" && payload.type === "message" && payload.role === "user") {
      return firstText(payload.content);
    }
    return "";
  }
  if (record.type !== "user" || !isRecord(record.message)) return "";
  if (record.message.role !== undefined && record.message.role !== "user") return "";
  return firstText(record.message.content);
}

function cwdFrom(record: Record<string, unknown>, kind: Kind): string | undefined {
  const payload = kind === "codex" && isRecord(record.payload) ? record.payload : record;
  const raw = payload.cwd;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function titleText(text: string): string {
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 60).join("");
}

function cwdBasename(cwd: string): string {
  const parts = cwd.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function fromHead(head: string, kind: Kind, file: FileCandidate): AgentInfo | null {
  let cwd: string | undefined;
  let user: string | undefined;
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    cwd ??= cwdFrom(parsed, kind);
    const extracted = userText(parsed, kind);
    if (!user && extracted.trim()) user = extracted;
    if (cwd && user) break;
  }
  const name = titleText(user || (cwd ? cwdBasename(cwd) : ""));
  if (!name) return null;
  return {
    id: kind + ":session:" + file.sessionId,
    kind,
    name,
    status: "available",
    sessionId: file.sessionId,
    ...(cwd ? { cwd } : {}),
    lastActivityAt: file.mtimeMs,
    source: "local-store",
  };
}

async function finishedFrom(
  fs: FsPort,
  kind: Kind,
  files: FileCandidate[],
  limit: number,
): Promise<AgentInfo[]> {
  const result: AgentInfo[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (result.length >= limit) break;
    if (seen.has(file.sessionId)) continue;
    try {
      const head = await fs.readHead(file.path, HEAD_BYTES);
      const row = fromHead(head, kind, file);
      if (!row) continue;
      result.push(row);
      seen.add(file.sessionId);
    } catch {
      // A removed, unreadable or malformed session is not a roster failure.
    }
  }
  return result;
}

/** Recent local JSONL sessions, not proof that a process has exited.
 * The roster must dedupe these against live rows before publishing. */
export async function listFinishedSessions(input: FinishedSessionsInput): Promise<AgentInfo[]> {
  if (!Number.isFinite(input.now)) return [];
  const requestedLimit = input.limitPerHarness ?? 200;
  const requestedDays = input.maxAgeDays ?? 30;
  if (!Number.isFinite(requestedLimit) || !Number.isFinite(requestedDays) ||
    requestedLimit <= 0 || requestedDays < 0) return [];
  const limit = Math.floor(requestedLimit);
  if (limit === 0) return [];
  const cutoff = input.now - requestedDays * DAY_MS;
  const codex = await codexFiles(input.fs, input.homeDir, cutoff);
  const claude = await claudeFiles(input.fs, input.homeDir, cutoff);
  const codexRows = await finishedFrom(input.fs, "codex", codex, limit);
  const claudeRows = await finishedFrom(input.fs, "claude", claude, limit);
  return [...codexRows, ...claudeRows];
}

/** The only native-filesystem entry point; enumeration itself uses injected FsPort. */
export function nodeFsPort(): FsPort {
  return {
    readdir,
    async stat(path) {
      const info = await stat(path);
      return { mtimeMs: info.mtimeMs, isDirectory: info.isDirectory(), size: info.size };
    },
    async readHead(path, maxBytes) {
      const size = Number.isFinite(maxBytes) ? Math.max(0, Math.min(HEAD_BYTES, Math.floor(maxBytes))) : 0;
      const handle = await open(path, "r");
      try {
        const bytes = Buffer.alloc(size);
        const { bytesRead } = await handle.read(bytes, 0, size, 0);
        return bytes.toString("utf8", 0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}
