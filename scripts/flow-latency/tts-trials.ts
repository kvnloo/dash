#!/usr/bin/env bun
/**
 * Summarize on-device TTS trials. Nearest-rank pXX uses the value at
 * max(1, ceil(p/100 * N)) in the ascending successful scored samples.
 *
 * Example:
 * bun scripts/flow-latency/tts-trials.ts trials.jsonl --planned short/edge,medium/cascade --min-n 100 --json
 */
import { readFileSync } from "node:fs";

export type TrialRow = {
  readonly tag: string;
  readonly k: number;
  readonly phase: "warmup" | "scored";
  readonly id: string;
  readonly bucket: string;
  readonly words: number;
  readonly threads: number;
  readonly ttfa_ms: number;
  readonly synth_ms: number;
  readonly audio_s: number;
  readonly rtf: number;
  readonly chunks: number;
  readonly max_chunk_gap_ms: number;
  readonly ok: 0 | 1;
};

export type ParsedTrials = {
  rows: TrialRow[];
  warnings: string[];
};

export type ArmSummary = {
  tag: string;
  /** Successful scored trials used for timing and the minimum-N gate. */
  n: number;
  /** Successful scored trials / all scored trials; null when none scored. */
  okRate: number | null;
  ttfaP50: number | null;
  ttfaP95: number | null;
  ttfaMax: number | null;
  rtfP50: number | null;
  maxChunkGapP95: number | null;
  enoughN: boolean;
};

export type TrialsSummary = {
  arms: ArmSummary[];
  missingArms: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMeasure(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function toTrialRow(value: unknown): TrialRow | null {
  if (!isRecord(value)) return null;
  const {
    tag, k, phase, id, bucket, words, threads, ttfa_ms, synth_ms,
    audio_s, rtf, chunks, max_chunk_gap_ms, ok,
  } = value;

  if (
    !isText(tag) || !isText(bucket) ||
    !tag.startsWith(bucket + "/") || tag.length <= bucket.length + 1 ||
    !isCount(k) || (phase !== "warmup" && phase !== "scored") ||
    !isText(id) || !isCount(words) || !isCount(threads) ||
    !isMeasure(ttfa_ms) || !isMeasure(synth_ms) ||
    !isMeasure(audio_s) || !isMeasure(rtf) ||
    !isCount(chunks) || !isMeasure(max_chunk_gap_ms) ||
    (ok !== 0 && ok !== 1)
  ) {
    return null;
  }

  // Return only schema fields, ignoring extra keys in device logs.
  return {
    tag, k, phase, id, bucket, words, threads, ttfa_ms, synth_ms,
    audio_s, rtf, chunks, max_chunk_gap_ms, ok,
  };
}

/** Invalid JSON and missing/invalid fields produce line-numbered warnings, never a throw. */
export function parseTrials(text: string): ParsedTrials {
  const rows: TrialRow[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").trim();
    if (!line) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      warnings.push("line " + (index + 1) + ": invalid JSON");
      continue;
    }
    const trial = toTrialRow(value);
    if (!trial) {
      warnings.push("line " + (index + 1) + ": missing or invalid required trial fields");
      continue;
    }
    rows.push(trial);
  }
  return { rows, warnings };
}

/** Null means the arm has no successful scored timing samples. */
function nearestRank(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)] ?? null;
}

export function summarizeArms(
  rows: readonly TrialRow[],
  options: { plannedArms?: readonly string[]; minN?: number } = {},
): TrialsSummary {
  const minN = options.minN ?? 100;
  if (!Number.isSafeInteger(minN) || minN < 1) {
    throw new RangeError("minN must be a positive safe integer");
  }

  const grouped = new Map<string, { scored: number; successes: TrialRow[] }>();
  for (const row of rows) {
    let group = grouped.get(row.tag);
    if (!group) {
      group = { scored: 0, successes: [] };
      grouped.set(row.tag, group);
    }
    if (row.phase !== "scored") continue;
    group.scored++;
    if (row.ok === 1) group.successes.push(row);
  }

  const arms = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, { scored, successes }]): ArmSummary => {
      const ttfa = successes.map((row) => row.ttfa_ms);
      return {
        tag,
        n: successes.length,
        okRate: scored === 0 ? null : successes.length / scored,
        ttfaP50: nearestRank(ttfa, 0.5),
        ttfaP95: nearestRank(ttfa, 0.95),
        ttfaMax: ttfa.length === 0 ? null : ttfa.reduce((max, value) => Math.max(max, value), 0),
        rtfP50: nearestRank(successes.map((row) => row.rtf), 0.5),
        maxChunkGapP95: nearestRank(successes.map((row) => row.max_chunk_gap_ms), 0.95),
        enoughN: successes.length >= minN,
      };
    });

  const missingArms = [...new Set(options.plannedArms ?? [])]
    .filter((tag) => !grouped.has(tag))
    .sort();
  return { arms, missingArms };
}

export function firstAudibleEstimate(
  llmFirstSentenceP50Ms: number,
  ttfaP50Ms: number,
): { estimateMs: number; note: string } {
  const estimateMs = llmFirstSentenceP50Ms + ttfaP50Ms;
  if (
    !isMeasure(llmFirstSentenceP50Ms) ||
    !isMeasure(ttfaP50Ms) ||
    !Number.isFinite(estimateMs)
  ) {
    throw new RangeError("latencies must be finite non-negative milliseconds");
  }
  return {
    estimateMs,
    note: "Stage sum of LLM first-sentence p50 and TTS TTFA p50; not a measured end-to-end first-audible latency.",
  };
}

type CliOptions = {
  file: string;
  plannedArms?: string[];
  minN: number;
  json: boolean;
};

function parseCli(argv: readonly string[]): CliOptions | null {
  const file = argv[0];
  if (!file || file.startsWith("-")) return null;
  let plannedArms: string[] | undefined;
  let minN = 100;
  let json = false;
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--json") {
      json = true;
    } else if (flag === "--planned") {
      const value = argv[++index];
      if (!value) return null;
      const tags = value.split(",").map((tag) => tag.trim());
      if (tags.some((tag) => !tag)) return null;
      plannedArms = tags;
    } else if (flag === "--min-n") {
      const value = argv[++index];
      if (!value || !/^[1-9]\d*$/.test(value)) return null;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) return null;
      minN = parsed;
    } else {
      return null;
    }
  }
  return { file, plannedArms, minN, json };
}

function display(value: number | null): string {
  return value === null ? "-" : String(value);
}

function printTable(summary: TrialsSummary): void {
  const headers = ["tag", "n", "okRate", "ttfaP50", "ttfaP95", "ttfaMax", "rtfP50", "gapP95", "enoughN"];
  const data = summary.arms.map((arm) => [
    arm.tag, String(arm.n),
    arm.okRate === null ? "-" : (arm.okRate * 100).toFixed(1) + "%",
    display(arm.ttfaP50), display(arm.ttfaP95), display(arm.ttfaMax),
    display(arm.rtfP50), display(arm.maxChunkGapP95), arm.enoughN ? "yes" : "no",
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...data.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ").trimEnd();
  console.log(format(headers));
  for (const row of data) console.log(format(row));
  if (data.length === 0) console.log("No valid trial rows.");
  if (summary.missingArms.length > 0) {
    console.log("Missing arms: " + summary.missingArms.join(", "));
  }
}

/** Return 0 for adequate trials, 1 for incomplete coverage, 2 for input/usage failure. */
export function runCli(argv: readonly string[]): number {
  const options = parseCli(argv);
  if (!options) {
    console.error("usage: bun scripts/flow-latency/tts-trials.ts <trials.jsonl> [--planned a,b,c] [--min-n 100] [--json]");
    return 2;
  }
  let content: string;
  try {
    content = readFileSync(options.file, "utf8");
  } catch (error) {
    console.error("cannot read " + options.file + ": " + (error instanceof Error ? error.message : String(error)));
    return 2;
  }

  const parsed = parseTrials(content);
  const summary = summarizeArms(parsed.rows, {
    plannedArms: options.plannedArms,
    minN: options.minN,
  });
  if (options.json) {
    console.log(JSON.stringify({
      validRows: parsed.rows.length,
      warnings: parsed.warnings,
      minN: options.minN,
      ...summary,
    }, null, 2));
  } else {
    printTable(summary);
  }
  for (const warning of parsed.warnings) console.error("warning: " + warning);

  return summary.missingArms.length > 0 ||
    summary.arms.some((arm) => !arm.enoughN) ||
    parsed.rows.length === 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = runCli(process.argv.slice(2));
}
