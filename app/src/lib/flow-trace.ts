import { TURBO } from "../turbo";

export function flowEnabled(turbo: boolean, enabled: boolean): boolean { return turbo && enabled; }
/** Explicit opt-in; Expo inlines these direct environment reads. */
export const flowMode = flowEnabled(TURBO, process.env.EXPO_PUBLIC_DASH_FLOW_MODE === "1");

export type FlowStage = "ink.down" | "ink.up" | "ink.frame" | "ink.submit" | "stylus.btn" | "pill.commit"
  | "input.pen" | "input.touch" | "input.mic" | "ack.paint" | "vad.start" | "word.paint"
  | "turn.commit" | "genui.loader" | "genui.first_node" | "audio.first_frame_out"
  | "playback.silence" | "gen.bump" | "genui.discard" | "refresh.save" | "refresh.paint" | "chip.paint";
export interface FlowMark { stage: FlowStage; trace_id: string; at: number; generation: number }
export interface ClockCalibration { offsetMs: number; uncertaintyMs: number }
export interface FlowDump { calibration: ClockCalibration | null; marks: FlowMark[] }
export interface FlowTrace {
  begin(): string;
  mark(stage: FlowStage, traceId: string, generation?: number, at?: number): void;
  markNative(stage: FlowStage, traceId: string, uptimeMs: number, generation?: number): boolean;
  calibrate(readUptime: () => Promise<number>): Promise<void>;
  dump(): FlowDump;
}
const emptyMarks: FlowMark[] = [];
const emptyDump: FlowDump = { calibration: null, marks: emptyMarks };
// One shared disabled object: no buffer, clock reads, timers, per-mark allocation or native work.
const disabled: FlowTrace = {
  begin: () => "", mark: () => {}, markNative: () => false,
  calibrate: () => Promise.resolve(), dump: () => emptyDump,
};

export function createFlowTrace(enabled: boolean, options: {
  now?: () => number; capacity?: number; buffer?: () => FlowMark[];
} = {}): FlowTrace {
  if (!enabled) return disabled;
  const now = options.now ?? (() => performance.now());
  const capacity = options.capacity ?? 2048;
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid flow trace capacity");
  const marks = options.buffer?.() ?? [];
  let cursor = 0, sequence = 0;
  let calibration: ClockCalibration | null = null;
  let calibrating: Promise<void> | undefined;
  function mark(stage: FlowStage, traceId: string, generation = 0, at = now()): void {
    if (!Number.isFinite(at)) return;
    marks[cursor] = { stage, trace_id: traceId, at, generation };
    cursor = (cursor + 1) % capacity;
  }
  return {
    begin: () => `flow-${++sequence}`,
    mark,
    markNative(stage, traceId, uptimeMs, generation = 0) {
      if (!calibration || !Number.isFinite(uptimeMs)) return false;
      mark(stage, traceId, generation, uptimeMs + calibration.offsetMs);
      return true;
    },
    calibrate(readUptime) {
      if (calibration) return Promise.resolve();
      if (calibrating) return calibrating;
      const before = now();
      calibrating = readUptime().then(uptime => {
        const after = now();
        if (![before, after, uptime].every(Number.isFinite) || after < before) return;
        calibration = { offsetMs: (before + after) / 2 - uptime, uncertaintyMs: (after - before) / 2 };
      }).catch(() => {}).finally(() => { calibrating = undefined; });
      return calibrating;
    },
    dump: () => ({ calibration, marks: marks.length < capacity ? marks.slice() : [...marks.slice(cursor), ...marks.slice(0, cursor)] }),
  };
}

export const flowTrace = createFlowTrace(flowMode);
