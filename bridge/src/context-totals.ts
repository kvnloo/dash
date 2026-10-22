import { openSync, closeSync, readSync, fstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { record, type ContextSnapshot } from "../../shared/context";

function positive(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function sum(usage: Record<string, unknown>, keys: string[]): number | undefined {
  const values = keys.map(key => positive(usage[key]));
  return values.some(v => v !== undefined) ? values.reduce<number>((n, v) => n + (v ?? 0), 0) : undefined;
}
/** Only per-request usage. Never confuse total_token_usage (lifetime throughput) with occupancy. */
export function parseHarnessTotal(harness: string, text: string, sessionId: string): ContextSnapshot | undefined {
  let used: number | undefined;
  let maximum = 0;
  let model = harness;
  for (const line of text.split("\n")) {
    let event: unknown;
    try { event = JSON.parse(line); } catch { continue; }
    if (!record(event)) continue;
    if (harness === "codex" && event.type === "event_msg" && record(event.payload) && event.payload.type === "token_count" && record(event.payload.info)) {
      const info = event.payload.info;
      const last = record(info.last_token_usage) ? info.last_token_usage : undefined;
      const count = last ? sum(last, ["input_tokens", "output_tokens"]) : undefined;
      if (count !== undefined) { used = count; maximum = positive(info.model_context_window) ?? 0; }
    }
    const message = record(event.message) ? event.message : undefined;
    if (message?.role === "assistant" && record(message.usage)) {
      const count = harness === "claude" ? sum(message.usage, ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"]) : harness === "omp" ? sum(message.usage, ["input", "cacheRead", "cacheWrite", "output"]) : undefined;
      if (count !== undefined) { used = count; if (typeof message.model === "string") model = message.model.slice(0, 120); }
    }
  }
  if (used === undefined) return;
  return { sessionId, model, used, maximum, threshold: 0, estimated: true, source: "last provider request (best-effort total)", categories: [], revision: `${harness}:${sessionId}`, notes: ["Total only. Categories, current turn delta and auto-compact threshold are unavailable for this harness."] };
}
function findSession(root: string, session: string): string | undefined {
  const queue = [{ dir: root, depth: 0 }];
  let scanned = 0;
  while (queue.length && scanned < 6000) {
    const entry = queue.shift(); if (!entry) break;
    try {
      for (const child of readdirSync(entry.dir, { withFileTypes: true })) {
        if (++scanned > 6000) break;
        // Never follow symlinks or inspect credential/config files.
        if (child.isDirectory() && entry.depth < 6) queue.push({ dir: join(entry.dir, child.name), depth: entry.depth + 1 });
        else if (child.isFile() && child.name.endsWith(".jsonl") && (child.name === `${session}.jsonl` || child.name.endsWith(`-${session}.jsonl`) || child.name.endsWith(`_${session}.jsonl`))) return join(entry.dir, child.name);
      }
    } catch { /* provider not installed */ }
  }
}
export function harnessTotal(harness: string, session: string): ContextSnapshot | undefined {
  if (!["omp", "codex", "claude"].includes(harness) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session)) return;
  const home = homedir();
  const root = harness === "codex" ? join(process.env.CODEX_HOME || join(home, ".codex"), "sessions") : harness === "claude" ? join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects") : join(process.env.PI_CODING_AGENT_DIR || join(home, ".omp", "agent"), "sessions");
  const path = findSession(root, session);
  if (!path) return;
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, 4 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return parseHarnessTotal(harness, buffer.toString("utf8"), session);
  } catch { return; } finally { if (fd !== undefined) closeSync(fd); }
}
