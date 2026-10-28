#!/usr/bin/env bun
/**
 * Pure getevent -lt stylus key parser and side-button -> pill-commit latency checker.
 * No adb/native dependencies. Pill marks are JSON numbers from the JS clock.
 */
import { readFileSync } from "node:fs";

export type ButtonEdge = {
  uptimeMs: number;
  code: string;
  pressed: boolean;
};

export type ParsedButtonEdges = {
  edges: ButtonEdge[];
  warnings: string[];
};

export type PairResult = {
  samples: number[];
  unmatched: number;
};

const DEFAULT_CODES: readonly string[] = ["BTN_STYLUS", "BTN_STYLUS2"];
const EVENT_LINE =
  /^\s*\[\s*(\d+)\.(\d{1,6})\s*\]\s+\/dev\/input\/event\d+:\s+(EV_[A-Z0-9_]+)\s+([A-Z0-9_]+)\s+(\S+)\s*$/;
const HEX_VALUE = /^(?:0x)?[0-9a-f]+$/i;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseButtonEdges(
  text: string,
  { codes = DEFAULT_CODES }: { codes?: readonly string[] } = {},
): ParsedButtonEdges {
  const allowed = new Set(codes);
  const edges: ButtonEdge[] = [];
  const warnings: string[] = [];

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = EVENT_LINE.exec(line);
    if (!match) {
      warnings.push("line " + (index + 1) + ": unrecognized getevent line");
      continue;
    }
    const secondsText = match[1];
    const microsText = match[2];
    const type = match[3];
    const code = match[4];
    const value = match[5];
    if (!secondsText || !microsText || !type || !code || !value) {
      warnings.push("line " + (index + 1) + ": incomplete getevent line");
      continue;
    }
    // Ignore well-formed sync and other key events without counting them as garbage.
    if (type !== "EV_KEY" || !allowed.has(code)) continue;

    let pressed: boolean;
    if (value === "DOWN") pressed = true;
    else if (value === "UP") pressed = false;
    else if (HEX_VALUE.test(value)) {
      pressed = Number.parseInt(value.replace(/^0x/i, ""), 16) !== 0;
    } else {
      warnings.push("line " + (index + 1) + ": invalid " + code + " value");
      continue;
    }

    // getevent timestamps are seconds since boot, with up to six microsecond digits.
    // Convert the fractional seconds to milliseconds without first rounding seconds.
    const uptimeMs =
      Number(secondsText) * 1000 + Number(microsText.padEnd(6, "0")) / 1000;
    if (!Number.isFinite(uptimeMs)) {
      warnings.push("line " + (index + 1) + ": non-finite timestamp");
      continue;
    }
    edges.push({ uptimeMs, code, pressed });
  }
  return { edges, warnings };
}

/** Collapse repeated DOWNs independently for each button until that code is released. */
export function risingEdges(edges: readonly ButtonEdge[]): ButtonEdge[] {
  const held = new Set<string>();
  const rising: ButtonEdge[] = [];
  for (const edge of edges) {
    if (!edge.pressed) {
      held.delete(edge.code);
    } else if (!held.has(edge.code)) {
      held.add(edge.code);
      rising.push(edge);
    }
  }
  return rising;
}

/**
 * offsetMs = uptime-clock milliseconds MINUS JS-clock milliseconds sampled at
 * the same instant. Add this signed offset to a JS pill-commit mark to put it
 * on the getevent uptime clock (often a large negative offset for Date.now).
 */
export function jsToUptimeMs(atMs: number, offsetMs: number): number {
  return atMs + offsetMs;
}

/**
 * Chronological, one-to-one greedy pairing. A commit preceding an edge cannot
 * satisfy it; a commit too late for an edge remains eligible for a later edge.
 */
export function pairWithPillCommits(
  rising: readonly ButtonEdge[],
  pillCommitUptimeMs: readonly number[],
  { windowMs = 500 }: { windowMs?: number } = {},
): PairResult {
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new RangeError("windowMs must be finite and nonnegative");
  }
  if (
    rising.some((edge) => !Number.isFinite(edge.uptimeMs)) ||
    pillCommitUptimeMs.some((mark) => !Number.isFinite(mark))
  ) {
    throw new RangeError("edge and commit timestamps must be finite");
  }

  const orderedEdges = [...rising].sort((a, b) => a.uptimeMs - b.uptimeMs);
  const commits = [...pillCommitUptimeMs].sort((a, b) => a - b);
  const samples: number[] = [];
  let unmatched = 0;
  let nextCommit = 0;

  for (const edge of orderedEdges) {
    while (nextCommit < commits.length && (commits[nextCommit] ?? 0) < edge.uptimeMs) {
      nextCommit++;
    }
    const commit = commits[nextCommit];
    if (commit !== undefined && commit - edge.uptimeMs <= windowMs) {
      samples.push(commit - edge.uptimeMs);
      nextCommit++;
    } else {
      unmatched++;
    }
  }
  return { samples, unmatched };
}

function nearestRank(samples: readonly number[], fraction: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

type CliOptions = {
  tracePath: string;
  marksPath: string;
  offsetMs: number;
  json: boolean;
};

const USAGE =
  "usage: bun scripts/flow-latency/stylus-button.ts <getevent.txt> " +
  "--pill <marks.json> --offset-ms N [--json]";

function parseCli(argv: readonly string[]): CliOptions {
  let tracePath: string | undefined;
  let marksPath: string | undefined;
  let offsetMs: number | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      if (json) throw new Error("duplicate --json; " + USAGE);
      json = true;
    } else if (arg === "--pill") {
      const value = argv[++i];
      if (marksPath !== undefined || !value || value.startsWith("--")) {
        throw new Error("invalid --pill; " + USAGE);
      }
      marksPath = value;
    } else if (arg === "--offset-ms") {
      const value = argv[++i];
      if (offsetMs !== undefined || !value || !DECIMAL.test(value) ||
          !Number.isFinite(Number(value))) {
        throw new Error("invalid --offset-ms; " + USAGE);
      }
      offsetMs = Number(value);
    } else if (!arg || arg.startsWith("-") || tracePath !== undefined) {
      throw new Error("unexpected argument; " + USAGE);
    } else {
      tracePath = arg;
    }
  }
  if (!tracePath || !marksPath || offsetMs === undefined) {
    throw new Error("missing required argument; " + USAGE);
  }
  return { tracePath, marksPath, offsetMs, json };
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));
}

function main(argv: readonly string[]): void {
  const options = parseCli(argv);
  const trace = readFileSync(options.tracePath, "utf8");
  const marks: unknown = JSON.parse(readFileSync(options.marksPath, "utf8"));
  if (!isFiniteNumberArray(marks)) {
    throw new Error("pill marks JSON must be an array of finite numbers");
  }

  const { edges, warnings } = parseButtonEdges(trace);
  const rising = risingEdges(edges);
  const uptimeMarks = marks.map((mark) => jsToUptimeMs(mark, options.offsetMs));
  const { samples, unmatched } = pairWithPillCommits(rising, uptimeMarks);
  const p50Ms = nearestRank(samples, 0.5);
  const p95Ms = nearestRank(samples, 0.95);

  if (options.json) {
    console.log(JSON.stringify({
      edges: edges.length,
      rising: rising.length,
      samples,
      unmatched,
      p50Ms,
      p95Ms,
      warnings,
    }));
  } else {
    console.log(
      "stylus button: " + rising.length + " rising, " +
      samples.length + " paired, " + unmatched + " unmatched",
    );
    console.log(
      "pill-change p50=" + (p50Ms === null ? "n/a" : p50Ms.toFixed(3) + "ms") +
      " (target <=50ms); p95=" +
      (p95Ms === null ? "n/a" : p95Ms.toFixed(3) + "ms") +
      " (target <=80ms)",
    );
    for (const warning of warnings) console.warn(warning);
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid input");
    process.exitCode = 2;
  }
}
