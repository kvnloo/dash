import { formatTool, redactTool, type FormatTool } from "../../../shared/tool-format";

export type CompactToolStatus = "running" | "ok" | "error";
export interface CompactToolRowModel {
  glyph: string;
  verb: string;
  target: string;
  status: CompactToolStatus;
  durationLabel?: string;
  accessibilityLabel: string;
  /** Only present when adjacent successful calls share the same verb. */
  count?: number;
  /** Input positions remain stable for Hermes drill-down after coalescing. */
  toolIndexes?: number[];
}

type KnownVerb = "Run" | "Read" | "Write" | "Edit" | "Search" | "Web" | "Task";

const glyphs: Record<KnownVerb, string> = {
  Run: "$", Read: "↓", Write: "↑", Edit: "✎",
  Search: "⌕", Web: "◎", Task: "◇",
};

/** Names are cross-harness, including Claude/OMP aliases and Hermes tools. */
function knownVerb(name: string): KnownVerb | undefined {
  const normalized = name.replace(/^functions\./i, "").toLowerCase();
  const leaf = normalized.split(/[./:]/).at(-1) ?? normalized;
  if (/^(?:web_|webfetch$|websearch$|browser|mcp__browser|mcp__web)/.test(leaf)) return "Web";
  if (["terminal", "shell", "bash", "execute_code", "exec_command", "run_command"].includes(leaf)) return "Run";
  if (["read", "read_file", "readfile", "fetch_file"].includes(leaf)) return "Read";
  if (["write", "write_file", "writefile", "create_file"].includes(leaf)) return "Write";
  if (["edit", "edit_file", "patch", "apply_patch", "update_file", "replace_in_file"].includes(leaf)) return "Edit";
  if (["search", "search_files", "grep", "find", "glob", "code_search"].includes(leaf)) return "Search";
  if (["task", "delegate_task", "spawn_agent", "todo", "todo_list"].includes(leaf)) return "Task";
  return undefined;
}

function compactStatus(status: string): CompactToolStatus {
  const value = status.trim().toLowerCase();
  if (["ok", "success", "completed", "done"].includes(value)) return "ok";
  if (["error", "failed", "failure", "cancelled", "canceled", "denied", "timeout", "timed_out"].includes(value)) return "error";
  // An unknown or newly introduced wire status must not be presented as success.
  return "running";
}

function finiteDuration(durationMs: number): number | undefined {
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
}

function durationLabel(durationMs: number): string | undefined {
  const valid = finiteDuration(durationMs);
  if (valid === undefined) return undefined;
  if (valid < 1000) return Math.floor(valid) + "ms";
  if (valid < 60_000) return (Math.floor(valid / 100) / 10).toFixed(1) + "s";
  const wholeSeconds = Math.floor(valid / 1000);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = String(wholeSeconds % 60).padStart(2, "0");
  return minutes + "m " + seconds + "s";
}

/** Keep the basename and line suffix on path targets rather than only the prefix. */
export function truncateToolTarget(value: string, maxLength = 48): string {
  const text = value.replace(/\s+/g, " ").trim();
  const limit = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : 48;
  if (text.length <= limit) return text;
  if (limit === 1) return "…";

  const basename = /(?:^|[/\\])([^/\\\s]+)$/.exec(text)?.[1];
  if (basename && text.length > basename.length) {
    if (basename.length <= limit - 2) {
      const prefix = text.slice(0, limit - basename.length - 2).replace(/[/\\]$/, "");
      return prefix + "…/" + basename;
    }
    if (basename.length === limit - 1) return "…" + basename;
    // A tiny caller budget cannot retain an entire basename: preserve its line suffix.
    return "…" + basename.slice(-(limit - 1));
  }
  const leading = Math.ceil((limit - 1) / 2);
  return text.slice(0, leading) + "…" + text.slice(-(limit - 1 - leading));
}

/**
 * Pure presentation projection. Always use the shared formatter's redacted
 * title, never its raw path or args; redact input before formatter shortening.
 */
export function compactToolRow(tool: FormatTool, harness = "hermes", targetBudget = 48): CompactToolRowModel {
  const safeTool: FormatTool = {
    name: redactTool(tool.name),
    args: redactTool(tool.args),
    output: redactTool(tool.output),
    status: tool.status,
    durationMs: tool.durationMs,
  };
  const formatted = formatTool(safeTool, harness);
  const family = knownVerb(tool.name);
  const verb = family ?? redactTool(tool.name).replace(/\s+/g, " ").trim();
  const glyph = family ? glyphs[family] : "·";
  const target = truncateToolTarget(redactTool(formatted.title), targetBudget);
  const status = compactStatus(tool.status);
  const duration = status === "running" ? undefined : durationLabel(tool.durationMs);
  const spokenStatus = status === "ok" ? "completed" : status === "error" ? "failed" : "running";
  const accessibilityLabel = redactTool(
    [verb, target, spokenStatus, duration].filter(part => part !== undefined && part !== "").join(", "),
  );
  return {
    glyph, verb, target, status,
    ...(duration !== undefined ? { durationLabel: duration } : {}),
    accessibilityLabel,
  };
}

/** Only adjacent successful calls with the same verb are coalesced; failures keep their own row. */
export function compactGroup(tools: readonly FormatTool[], harness = "hermes"): CompactToolRowModel[] {
  const rows: CompactToolRowModel[] = [];
  let pending: { row: CompactToolRowModel; elapsed?: number; index: number }[] = [];

  const flush = () => {
    const first = pending[0];
    if (!first) return;
    if (pending.length === 1) {
      rows.push({ ...first.row, toolIndexes: [first.index] });
    } else {
      const latest = pending[pending.length - 1]?.row ?? first.row;
      const count = pending.length;
      const validDurations = pending.every(item => item.elapsed !== undefined);
      const duration = validDurations
        ? durationLabel(pending.reduce((total, item) => total + (item.elapsed ?? 0), 0))
        : undefined;
      const accessibilityLabel = redactTool(
        [first.row.verb, count + " successful calls", "latest target " + latest.target, "completed", duration]
          .filter(part => part !== undefined).join(", "),
      );
      rows.push({
        glyph: first.row.glyph, verb: first.row.verb, target: latest.target,
        status: "ok", count, toolIndexes: pending.map(item => item.index),
        ...(duration !== undefined ? { durationLabel: duration } : {}),
        accessibilityLabel,
      });
    }
    pending = [];
  };

  for (const [index, tool] of tools.entries()) {
    const row = compactToolRow(tool, harness);
    if (row.status !== "ok") {
      flush();
      rows.push({ ...row, toolIndexes: [index] });
      continue;
    }
    if (pending.length && pending[0]?.row.verb !== row.verb) flush();
    pending.push({ row, elapsed: finiteDuration(tool.durationMs), index });
  }
  flush();
  return rows;
}
