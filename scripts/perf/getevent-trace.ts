#!/usr/bin/env bun
/**
 * Pure parser for adb shell getevent -lt captures. Nothing in this module
 * invokes adb or sends input to a device.
 *
 * A point is sampled at SYN_REPORT, using that frame's timestamp. Raw axis
 * maxima are inclusive: 0 maps to pixel 0 and maxX maps to screenW - 1.
 * Screen coordinates and swipe duration use Math.round (half up for
 * nonnegative values); swipe durations are at least 1 ms.
 */
import { readFileSync } from "node:fs";

export type InputEvent = {
  tUs: number;
  device: string;
  type: string;
  code: string;
  value: number;
};

export type ParsedInputEvents = InputEvent[] & { warnings: string[] };

export type GesturePoint = { tUs: number; x: number; y: number };
export type Gesture = {
  startUs: number;
  endUs: number;
  durationMs: number;
  points: GesturePoint[];
};
export type GestureList = Gesture[] & { warnings: string[] };

export type ReplayOptions = {
  maxX: number;
  maxY: number;
  screenW: number;
  screenH: number;
};

export type ReplayPlan =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs: number };

const EVENT_LINE = /^\[\s*(\d+)\.(\d{1,6})\]\s+(\S+):\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;

function eventValue(raw: string): number | null {
  if (raw === "DOWN") return 1;
  if (raw === "UP") return 0;
  if (raw === "REPEAT") return 2;
  const digits = raw.replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]{1,8}$/.test(digits)) return null;
  const unsigned = Number.parseInt(digits, 16);
  return unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned;
}

export function parseGetevent(text: string): ParsedInputEvents {
  const events: InputEvent[] = [];
  const warnings: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || /^add device\b/i.test(trimmed) || /^name\s*:/i.test(trimmed)) continue;

    const match = EVENT_LINE.exec(trimmed);
    const seconds = match?.[1];
    const micros = match?.[2];
    const device = match?.[3];
    const type = match?.[4];
    const code = match?.[5];
    const valueText = match?.[6];
    if (!seconds || !micros || !device || !type || !code || !valueText) {
      warnings.push("line " + (index + 1) + ": unparseable event: " + trimmed);
      continue;
    }

    const tUs = Number.parseInt(seconds, 10) * 1_000_000 +
      Number.parseInt(micros.padEnd(6, "0"), 10);
    const value = eventValue(valueText);
    if (!Number.isSafeInteger(tUs) || value === null) {
      warnings.push("line " + (index + 1) + ": invalid timestamp/value: " + trimmed);
      continue;
    }

    events.push({ tUs, device, type, code, value });
  }
  return Object.assign(events, { warnings });
}

type DeviceState = {
  frame: InputEvent[];
  active: boolean;
  slot: number;
  // ABS_MT_POSITION_* are persistent slot values, not contact-local values.
  // Keep them across lifts/new tracking IDs; SYN_DROPPED invalidates them.
  x: number | null;
  y: number | null;
  trackingId: number | null;
  startUs: number;
  points: GesturePoint[];
};

function newDeviceState(): DeviceState {
  return {
    frame: [],
    active: false,
    slot: 0,
    x: null,
    y: null,
    trackingId: null,
    startUs: 0,
    points: [],
  };
}

function samplePoint(state: DeviceState, tUs: number): void {
  if (!state.active || state.x === null || state.y === null) return;
  const last = state.points[state.points.length - 1];
  if (!last || last.x !== state.x || last.y !== state.y) {
    state.points.push({ tUs, x: state.x, y: state.y });
  }
}

function beginContact(state: DeviceState, tUs: number, trackingId: number | null): void {
  state.active = true;
  state.startUs = tUs;
  state.trackingId = trackingId;
  state.points = [];
}

function endContact(
  state: DeviceState,
  device: string,
  tUs: number,
  gestures: Gesture[],
  warnings: string[],
): void {
  if (!state.active) return;
  // A final position change before lift belongs to the ending contact,
  // even when the next contact starts before this SYN_REPORT.
  samplePoint(state, tUs);
  if (state.points.length === 0) {
    warnings.push(device + " at " + tUs + ": contact ended without slot-0 coordinates");
  } else if (tUs < state.startUs) {
    warnings.push(device + " at " + tUs + ": nonmonotonic gesture timestamps");
  } else {
    gestures.push({
      startUs: state.startUs,
      endUs: tUs,
      durationMs: (tUs - state.startUs) / 1_000,
      points: state.points,
    });
  }
  state.active = false;
  state.trackingId = null;
  state.points = [];
  // Do NOT reset state.x/state.y: protocol-B slot axes persist across contacts.
}

function processFrame(
  state: DeviceState,
  device: string,
  tUs: number,
  gestures: Gesture[],
  warnings: string[],
): void {
  // Tracking-ID changes are authoritative within their frame. BTN_TOUCH
  // duplicates must not close a newly replaced slot-0 contact or start a
  // phantom slot-0 contact when only a secondary slot is active.
  const hasTrackingChange = state.frame.some(
    (event) => event.type === "EV_ABS" && event.code === "ABS_MT_TRACKING_ID",
  );
  let slot = state.slot;
  let needsSample = false;

  // Process *in order*: lift and new-down can share one SYN_REPORT.
  // Collapsing a frame into "begins"/"ends" loses the replacement contact.
  for (const event of state.frame) {
    if (event.type === "EV_ABS" && event.code === "ABS_MT_SLOT") {
      slot = event.value;
      if (slot !== 0) {
        warnings.push(device + " at " + tUs + ": ignoring multi-touch slot " + slot);
      }
    } else if (event.type === "EV_ABS" && slot === 0 &&
               event.code === "ABS_MT_TRACKING_ID") {
      if (event.value >= 0) {
        if (state.active && state.trackingId !== null &&
            state.trackingId !== event.value) {
          warnings.push(device + " at " + tUs + ": tracking ID changed without lift");
          endContact(state, device, tUs, gestures, warnings);
        }
        if (!state.active) beginContact(state, tUs, event.value);
        state.trackingId = event.value;
        needsSample = true;
      } else if (event.value === -1) {
        endContact(state, device, tUs, gestures, warnings);
        needsSample = false;
      } else {
        warnings.push(device + " at " + tUs + ": invalid tracking id " + event.value);
      }
    } else if (event.type === "EV_ABS" && slot === 0 &&
               event.code === "ABS_MT_POSITION_X") {
      state.x = event.value;
      needsSample = true;
    } else if (event.type === "EV_ABS" && slot === 0 &&
               event.code === "ABS_MT_POSITION_Y") {
      state.y = event.value;
      needsSample = true;
    } else if (event.type === "EV_KEY" && event.code === "BTN_TOUCH" &&
               !hasTrackingChange) {
      if (event.value === 0) {
        endContact(state, device, tUs, gestures, warnings);
        needsSample = false;
      } else if (event.value === 1) {
        if (!state.active) beginContact(state, tUs, null);
        needsSample = true;
      }
    }
  }

  state.slot = slot;
  state.frame = [];
  if (state.active && needsSample) samplePoint(state, tUs);
}

/**
 * Groups changes into SYN_REPORT frames, independently for each input device.
 * Only ABS_MT_SLOT 0 contributes coordinates. Incomplete gestures are warned
 * about and discarded rather than silently emitted as successful replays.
 */
export function toGestures(
  events: readonly InputEvent[],
  options: { device?: string } = {},
): GestureList {
  const gestures: Gesture[] = [];
  const warnings: string[] = [];
  const states = new Map<string, DeviceState>();
  for (const event of events) {
    if (options.device !== undefined && event.device !== options.device) continue;
    let state = states.get(event.device);
    if (!state) {
      state = newDeviceState();
      states.set(event.device, state);
    }
    if (event.type === "EV_SYN" && event.code === "SYN_DROPPED") {
      warnings.push(event.device + " at " + event.tUs + ": SYN_DROPPED; discarding unsynchronized gesture");
      states.set(event.device, newDeviceState());
    } else if (event.type === "EV_SYN" && event.code === "SYN_REPORT") {
      processFrame(state, event.device, event.tUs, gestures, warnings);
    } else {
      state.frame.push(event);
    }
  }
  for (const [device, state] of states) {
    if (state.frame.length > 0) warnings.push(device + ": missing final SYN_REPORT frame");
    if (state.active) warnings.push(device + ": unfinished gesture without lift");
  }
  gestures.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs);
  return Object.assign(gestures, { warnings });
}

function requireDimension(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(name + " must be a positive safe integer");
  }
}

function scaled(value: number, axisMax: number, screenSize: number): number {
  if (!Number.isFinite(value)) throw new Error("non-finite touch coordinate");
  return Math.max(0, Math.min(axisMax, value)) / axisMax * (screenSize - 1);
}

/**
 * A tap has less than 10 px of cumulative path length (not just endpoint
 * displacement). Swipe commands use the first/last point because Android's
 * input swipe primitive cannot reproduce intermediate curve samples.
 */
export function replayPlan(gesture: Gesture, options: ReplayOptions): ReplayPlan {
  requireDimension(options.maxX, "maxX");
  requireDimension(options.maxY, "maxY");
  requireDimension(options.screenW, "screenW");
  requireDimension(options.screenH, "screenH");
  const first = gesture.points[0];
  const last = gesture.points[gesture.points.length - 1];
  if (!first || !last) throw new Error("gesture has no coordinate points");

  const pixels = gesture.points.map((p) => ({
    x: scaled(p.x, options.maxX, options.screenW),
    y: scaled(p.y, options.maxY, options.screenH),
  }));
  let distance = 0;
  for (let i = 1; i < pixels.length; i++) {
    const a = pixels[i - 1];
    const b = pixels[i];
    if (a && b) distance += Math.hypot(b.x - a.x, b.y - a.y);
  }

  const x1 = Math.round(scaled(first.x, options.maxX, options.screenW));
  const y1 = Math.round(scaled(first.y, options.maxY, options.screenH));
  if (distance < 10) return { kind: "tap", x: x1, y: y1 };

  if (!Number.isFinite(gesture.durationMs) || gesture.durationMs < 0) {
    throw new Error("invalid gesture duration");
  }
  return {
    kind: "swipe",
    x1,
    y1,
    x2: Math.round(scaled(last.x, options.maxX, options.screenW)),
    y2: Math.round(scaled(last.y, options.maxY, options.screenH)),
    durationMs: Math.max(1, Math.round(gesture.durationMs)),
  };
}

export function toInputCommand(plan: ReplayPlan): string {
  if (plan.kind === "tap") return "input tap " + plan.x + " " + plan.y;
  return "input swipe " + plan.x1 + " " + plan.y1 + " " +
    plan.x2 + " " + plan.y2 + " " + plan.durationMs;
}

type CliArgs = { file: string; options: ReplayOptions; json: boolean };
const USAGE = "usage: bun scripts/perf/getevent-trace.ts <trace.txt> --max-x N --max-y N --screen WxH [--json]";

function integerArg(text: string | undefined, name: string): number {
  if (!text || !/^\d+$/.test(text)) throw new Error("invalid " + name);
  const parsed = Number(text);
  requireDimension(parsed, name);
  return parsed;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let file = "";
  let maxX: number | undefined;
  let maxY: number | undefined;
  let screenW: number | undefined;
  let screenH: number | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--max-x" || arg === "--max-y") {
      const value = integerArg(argv[++i], arg);
      if (arg === "--max-x") maxX = value;
      else maxY = value;
    } else if (arg === "--screen") {
      const screen = /^(\d+)[xX](\d+)$/.exec(argv[++i] ?? "");
      if (!screen) throw new Error("invalid --screen, expected WxH");
      screenW = integerArg(screen[1], "screen width");
      screenH = integerArg(screen[2], "screen height");
    } else if (arg?.startsWith("-") || file) {
      throw new Error("unexpected argument: " + arg);
    } else if (arg) {
      file = arg;
    }
  }
  if (!file || maxX === undefined || maxY === undefined ||
      screenW === undefined || screenH === undefined) {
    throw new Error("missing trace or axis/screen dimensions");
  }
  return { file, options: { maxX, maxY, screenW, screenH }, json };
}

async function main(argv: readonly string[]): Promise<void> {
  try {
    const args = parseCliArgs(argv);
    const parsed = parseGetevent(readFileSync(args.file, "utf8"));
    if (parsed.length === 0) throw new Error("no valid getevent events");
    const gestures = toGestures(parsed);
    if (gestures.length === 0) throw new Error("no complete slot-0 gestures");
    const plans = gestures.map((gesture) => replayPlan(gesture, args.options));
    const commands = plans.map(toInputCommand);
    const warnings = [...parsed.warnings, ...gestures.warnings];
    if (args.json) {
      console.log(JSON.stringify({ gestures, plans, commands, warnings }, null, 2));
    } else {
      for (const warning of warnings) console.error("warning: " + warning);
      for (const command of commands) console.log(command);
    }
  } catch (error) {
    console.error("getevent: " + (error instanceof Error ? error.message : String(error)));
    console.error(USAGE);
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
