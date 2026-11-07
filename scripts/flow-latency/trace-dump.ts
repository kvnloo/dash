#!/usr/bin/env bun
/** Parse a dev-only Flow trace dump and report one stage-pair latency per turn. */
import { readFileSync } from "node:fs";

// Kept local: app/src/lib/flow-trace.ts is not on this integration lane.
export type FlowStage =
  | "ink.down" | "ink.up" | "ink.frame" | "ink.submit" | "stylus.btn" | "pill.commit"
  | "input.pen" | "input.touch" | "input.mic" | "ack.paint" | "vad.start" | "word.paint"
  | "turn.commit" | "genui.loader" | "genui.first_node" | "audio.first_frame_out"
  | "playback.silence" | "gen.bump" | "genui.discard" | "refresh.save" | "refresh.paint"
  | "chip.paint";

export interface FlowMark {
  stage: FlowStage;
  trace_id: string;
  at: number;
  generation: number;
}
export interface ClockCalibration {
  offsetMs: number;
  uncertaintyMs: number;
}
export interface FlowDump {
  calibration: ClockCalibration | null;
  marks: FlowMark[];
}
export type FlowParseResult =
  | { ok: true; dump: FlowDump }
  | { ok: false; error: string };
export interface StagePair {
  id: string;
  start: readonly FlowStage[];
  end: FlowStage;
  native?: boolean;
}
export interface PairSamples {
  samples: Map<string, number[]>;
  unmatched: Map<string, number>;
  skippedUncalibrated: number;
}

const FLOW_STAGES: ReadonlySet<string> = new Set([
  "ink.down", "ink.up", "ink.frame", "ink.submit", "stylus.btn", "pill.commit",
  "input.pen", "input.touch", "input.mic", "ack.paint", "vad.start", "word.paint",
  "turn.commit", "genui.loader", "genui.first_node", "audio.first_frame_out",
  "playback.silence", "gen.bump", "genui.discard", "refresh.save", "refresh.paint",
  "chip.paint",
]);

export const DEFAULT_PAIRS: readonly StagePair[] = [
  { id: "pen-to-frame", start: ["ink.down"], end: "ink.frame", native: true },
  { id: "mic-to-word", start: ["input.mic", "vad.start"], end: "word.paint", native: true },
  { id: "commit-to-loader", start: ["turn.commit"], end: "genui.loader" },
  { id: "commit-to-first-node", start: ["turn.commit"], end: "genui.first_node" },
  { id: "commit-to-first-audio", start: ["turn.commit"], end: "audio.first_frame_out", native: true },
];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function flowStage(value: unknown): value is FlowStage {
  return typeof value === "string" && FLOW_STAGES.has(value);
}
function invalid(error: string): FlowParseResult {
  return { ok: false, error };
}

/** All fields are copied only after validation; invalid inputs never produce partial samples. */
export function parseFlowDump(raw: unknown): FlowParseResult {
  if (!record(raw)) return invalid("dump must be an object");
  if (!Array.isArray(raw.marks)) return invalid("marks must be an array");

  let calibration: ClockCalibration | null = null;
  if (raw.calibration !== null) {
    if (!record(raw.calibration) ||
        !finite(raw.calibration.offsetMs) ||
        !finite(raw.calibration.uncertaintyMs)) {
      return invalid("calibration must be null or finite offsetMs and uncertaintyMs");
    }
    calibration = {
      offsetMs: raw.calibration.offsetMs,
      uncertaintyMs: raw.calibration.uncertaintyMs,
    };
  }

  const marks: FlowMark[] = [];
  const source: unknown[] = raw.marks;
  for (let i = 0; i < source.length; i++) {
    const entry = source[i];
    if (!record(entry)) return invalid("marks[" + i + "] must be an object");
    const { stage, trace_id, at, generation } = entry;
    if (!flowStage(stage)) return invalid("marks[" + i + "].stage is not a FlowStage");
    if (typeof trace_id !== "string" || trace_id.trim().length === 0 || trace_id.length > 64) {
      return invalid("marks[" + i + "].trace_id must contain 1-64 non-whitespace characters");
    }
    if (!finite(at)) return invalid("marks[" + i + "].at must be finite");
    if (typeof generation !== "number" ||
        !Number.isSafeInteger(generation) || generation < 0) {
      return invalid("marks[" + i + "].generation must be a non-negative safe integer");
    }
    marks.push({ stage, trace_id, at, generation });
  }
  return { ok: true, dump: { calibration, marks } };
}

/**
 * For each (trace, pair), select the earliest start by timestamp and the
 * earliest eligible end at or after it, never by input-array order.
 * Uncalibrated cross-clock pairs are skipped per trace with a start mark.
 */
export function pairSamples(dump: FlowDump, pairs: readonly StagePair[]): PairSamples {
  const samples = new Map<string, number[]>();
  const unmatched = new Map<string, number>();
  const traces = new Map<string, FlowMark[]>();
  for (const mark of dump.marks) {
    let grouped = traces.get(mark.trace_id);
    if (!grouped) {
      grouped = [];
      traces.set(mark.trace_id, grouped);
    }
    grouped.push(mark);
  }
  for (const marks of traces.values()) marks.sort((a, b) => a.at - b.at);

  let skippedUncalibrated = 0;
  for (const pair of pairs) {
    const values: number[] = [];
    let missing = 0;
    for (const marks of traces.values()) {
      const start = marks.find(mark => pair.start.includes(mark.stage));
      if (!start) continue;
      if (pair.native === true && dump.calibration === null) {
        skippedUncalibrated++;
        continue;
      }
      const end = marks.find(mark =>
        mark.stage === pair.end &&
        mark.at >= start.at &&
        mark.generation >= start.generation,
      );
      const duration = end === undefined ? NaN : end.at - start.at;
      if (Number.isFinite(duration)) values.push(duration);
      else missing++;
    }
    samples.set(pair.id, values);
    unmatched.set(pair.id, missing);
  }
  return { samples, unmatched, skippedUncalibrated };
}

/** The only file I/O: read UTF-8 JSON and return a nonthrowing parse result. */
export function loadDumpFile(path: string): FlowParseResult {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    return invalid("cannot read dump: " + (error instanceof Error ? error.message : String(error)));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return invalid("invalid JSON dump");
  }
  return parseFlowDump(raw);
}

function cli(args: readonly string[]): number {
  if (args.length < 1 || args.length > 2 || args[0] === "--json" ||
      (args.length === 2 && args[1] !== "--json")) {
    console.error("Usage: bun scripts/flow-latency/trace-dump.ts <dump.json> [--json]");
    return 2;
  }
  const path = args[0];
  if (!path) return 2;
  const parsed = loadDumpFile(path);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  const result = pairSamples(parsed.dump, DEFAULT_PAIRS);
  const pairs = DEFAULT_PAIRS.map(pair => ({
    id: pair.id,
    samples: result.samples.get(pair.id) ?? [],
    unmatched: result.unmatched.get(pair.id) ?? 0,
  }));
  if (args[1] === "--json") {
    console.log(JSON.stringify({ pairs, skippedUncalibrated: result.skippedUncalibrated }, null, 2));
  } else {
    for (const pair of pairs) {
      console.log(pair.id + ": " + pair.samples.length + " sample(s) [" +
        pair.samples.map(ms => ms + "ms").join(", ") + "]; unmatched=" + pair.unmatched);
    }
    console.log("skippedUncalibrated=" + result.skippedUncalibrated);
  }
  return 0;
}

if (import.meta.main) process.exitCode = cli(process.argv.slice(2));
