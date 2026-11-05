#!/usr/bin/env bun
/**
 * Parse a saved Android gfxinfo framestats dump and enforce a frame-time gate.
 *
 * Capture is deliberately separate from parsing:
 *   adb shell dumpsys gfxinfo <pkg> reset
 *   # Interact with the measured screen.
 *   adb shell dumpsys gfxinfo <pkg> framestats > dump.txt
 *
 * Then run:
 *   bun scripts/perf/gfxinfo-framestats.ts dump.txt --budget-ms 25 --json
 *
 * A pass means no *measured, unflagged* frame exceeds the budget. It does not
 * establish device smoothness without a representative capture window.
 */
import { readFileSync } from "node:fs";

export type FrameStat = {
  intendedVsyncNs: bigint;
  frameCompletedNs: bigint;
  durationMs: number;
  flags: number;
};

/** The array contains only accepted frames; metadata accounts for flagged rows. */
export type ParsedFramestats = FrameStat[] & { skippedFlagged: number };

export type FrameSummary = {
  frames: number;
  skippedFlagged: number;
  p50Ms: number | null;
  p90Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  overBudget: number;
  pass: boolean;
  reason?: "no-frames";
};

export type FramestatsErrorCode =
  | "no-profiledata"
  | "missing-header"
  | "invalid-header"
  | "invalid-row"
  | "unterminated-block";

export class FramestatsParseError extends Error {
  readonly code: FramestatsErrorCode;
  readonly lineNumber: number | null;

  constructor(code: FramestatsErrorCode, message: string, lineNumber: number | null = null) {
    super(message);
    this.name = "FramestatsParseError";
    this.code = code;
    this.lineNumber = lineNumber;
  }
}

type Header = {
  columnCount: number;
  flags: number;
  intendedVsync: number;
  frameCompleted: number;
};

const MARKER = "---PROFILEDATA---";
const NS_PER_MS = 1_000_000;

function parseHeader(line: string, lineNumber: number): Header {
  const columns = line.split(",").map((column) => column.trim());
  for (const required of ["Flags", "IntendedVsync", "FrameCompleted"]) {
    if (columns.filter((column) => column === required).length !== 1) {
      throw new FramestatsParseError(
        "invalid-header",
        "Expected exactly one " + required + " column at line " + lineNumber,
        lineNumber,
      );
    }
  }
  return {
    columnCount: columns.length,
    flags: columns.indexOf("Flags"),
    intendedVsync: columns.indexOf("IntendedVsync"),
    frameCompleted: columns.indexOf("FrameCompleted"),
  };
}

function parseUnsignedInteger(cell: string | undefined, name: string, lineNumber: number): string {
  if (!cell || !/^\d+$/.test(cell)) {
    throw new FramestatsParseError(
      "invalid-row",
      "Invalid " + name + " at line " + lineNumber,
      lineNumber,
    );
  }
  return cell;
}

function parseNanoseconds(cell: string | undefined, name: string, lineNumber: number): bigint {
  const value = BigInt(parseUnsignedInteger(cell, name, lineNumber));
  if (value === 0n) {
    throw new FramestatsParseError(
      "invalid-row",
      name + " must be positive at line " + lineNumber,
      lineNumber,
    );
  }
  return value;
}

/**
 * Android emits pairs of PROFILEDATA markers around a CSV block. The header
 * varies by OS version, so all required fields are looked up by name.
 * Flagged rows never enter the returned FrameStat array; their count is kept
 * on the returned array so summarize() can report skippedFlagged exactly.
 */
export function parseFramestats(text: string): ParsedFramestats {
  const accepted: FrameStat[] = [];
  const frames = Object.assign(accepted, { skippedFlagged: 0 });
  let inBlock = false;
  let header: Header | null = null;
  let blocks = 0;
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = (lines[index] ?? "").trim();

    if (line === MARKER) {
      if (!inBlock) {
        inBlock = true;
        header = null;
        blocks++;
      } else {
        if (header === null) {
          throw new FramestatsParseError(
            "missing-header",
            "PROFILEDATA block is missing a CSV header at line " + lineNumber,
            lineNumber,
          );
        }
        inBlock = false;
        header = null;
      }
      continue;
    }
    if (!inBlock || line.length === 0) continue;

    if (header === null) {
      header = parseHeader(line, lineNumber);
      continue;
    }

    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== header.columnCount) {
      throw new FramestatsParseError(
        "invalid-row",
        "Wrong CSV column count at line " + lineNumber,
        lineNumber,
      );
    }

    const flagsRaw = parseUnsignedInteger(cells[header.flags], "Flags", lineNumber);
    const flags = Number(flagsRaw);
    if (!Number.isSafeInteger(flags)) {
      throw new FramestatsParseError("invalid-row", "Flags out of range at line " + lineNumber, lineNumber);
    }
    if (flags !== 0) {
      frames.skippedFlagged++;
      continue;
    }

    const intendedVsyncNs = parseNanoseconds(
      cells[header.intendedVsync],
      "IntendedVsync",
      lineNumber,
    );
    const frameCompletedNs = parseNanoseconds(
      cells[header.frameCompleted],
      "FrameCompleted",
      lineNumber,
    );
    if (frameCompletedNs < intendedVsyncNs) {
      throw new FramestatsParseError(
        "invalid-row",
        "FrameCompleted precedes IntendedVsync at line " + lineNumber,
        lineNumber,
      );
    }

    const durationMs = Number(frameCompletedNs - intendedVsyncNs) / NS_PER_MS;
    if (!Number.isFinite(durationMs)) {
      throw new FramestatsParseError(
        "invalid-row",
        "Frame duration is not finite at line " + lineNumber,
        lineNumber,
      );
    }
    frames.push({ intendedVsyncNs, frameCompletedNs, durationMs, flags });
  }

  if (inBlock) {
    throw new FramestatsParseError(
      "unterminated-block",
      "PROFILEDATA block has no closing marker",
      lines.length,
    );
  }
  if (blocks === 0) {
    throw new FramestatsParseError("no-profiledata", "No PROFILEDATA block found");
  }
  return frames;
}

function nearestRank(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new Error("Cannot calculate percentile of empty data");
  return value;
}

export function summarize(
  frames: readonly FrameStat[],
  { budgetMs = 25 }: { budgetMs?: number } = {},
): FrameSummary {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError("budgetMs must be a finite positive number");
  }

  const unflagged = frames.filter((frame) => frame.flags === 0);
  const alreadySkipped =
    "skippedFlagged" in frames && typeof frames.skippedFlagged === "number"
      ? frames.skippedFlagged
      : 0;
  const skippedFlagged = alreadySkipped + frames.length - unflagged.length;
  const durations = unflagged.map((frame) => frame.durationMs).sort((a, b) => a - b);
  const overBudget = durations.filter((duration) => duration > budgetMs).length;

  if (durations.length === 0) {
    return {
      frames: 0,
      skippedFlagged,
      p50Ms: null,
      p90Ms: null,
      p99Ms: null,
      maxMs: null,
      overBudget: 0,
      pass: false,
      reason: "no-frames",
    };
  }

  return {
    frames: durations.length,
    skippedFlagged,
    p50Ms: nearestRank(durations, 0.5),
    p90Ms: nearestRank(durations, 0.9),
    p99Ms: nearestRank(durations, 0.99),
    maxMs: durations[durations.length - 1] ?? null,
    overBudget,
    pass: overBudget === 0,
  };
}

const USAGE = "Usage: bun scripts/perf/gfxinfo-framestats.ts <dump.txt> [--budget-ms 25] [--json]";

function parseCliArgs(args: readonly string[]): { path: string; budgetMs: number; json: boolean } {
  let path: string | null = null;
  let budgetMs = 25;
  let json = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--budget-ms") {
      const value = args[++index];
      if (!value || !value.trim()) throw new Error(USAGE);
      budgetMs = Number(value);
      if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
        throw new Error("--budget-ms must be a finite positive number");
      }
    } else if (!arg || arg.startsWith("-") || path !== null) {
      throw new Error(USAGE);
    } else {
      path = arg;
    }
  }
  if (path === null) throw new Error(USAGE);
  return { path, budgetMs, json };
}

function formatHuman(summary: FrameSummary, budgetMs: number): string {
  const format = (value: number | null) => value === null ? "n/a" : value.toFixed(3) + " ms";
  return [
    (summary.pass ? "PASS" : "FAIL") + " gfxinfo gate (" + budgetMs + " ms budget)",
    "frames=" + summary.frames + " flagged-skipped=" + summary.skippedFlagged +
      " over-budget=" + summary.overBudget,
    "p50=" + format(summary.p50Ms) + " p90=" + format(summary.p90Ms) +
      " p99=" + format(summary.p99Ms) + " max=" + format(summary.maxMs),
    ...(summary.reason ? ["reason=" + summary.reason] : []),
  ].join("\n");
}

/** Exit codes: 0 pass, 1 valid data failing the gate, 2 invalid input or usage. */
export function runCli(args: readonly string[]): number {
  try {
    const options = parseCliArgs(args);
    const text = readFileSync(options.path, "utf8");
    const summary = summarize(parseFramestats(text), { budgetMs: options.budgetMs });
    console.log(options.json ? JSON.stringify(summary) : formatHuman(summary, options.budgetMs));
    return summary.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to process framestats dump");
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = runCli(process.argv.slice(2));
}
