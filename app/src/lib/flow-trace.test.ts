import { expect, test } from "bun:test";
import { createFlowTrace, flowEnabled } from "./flow-trace";

 test("bundle opt-in remains off by default and needs turbo", async () => {
  for (const [turbo, flow, expected] of [["1", "1", true], ["1", "0", false], ["0", "1", false], ["", "", false]]) {
    const child = Bun.spawn([process.execPath, "-e", 'import { flowMode } from "./app/src/lib/flow-trace"; console.log(flowMode)'], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env: { ...process.env, EXPO_PUBLIC_DASH_TURBO: String(turbo), EXPO_PUBLIC_DASH_FLOW_MODE: String(flow) }, stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
    expect((await new Response(child.stdout).text()).trim()).toBe(String(expected));
  }
});

test("invalid ring capacities are rejected", () => {
  for (const capacity of [0, -1, 1.5, NaN]) expect(() => createFlowTrace(true, { capacity })).toThrow();
});

test("flowMode defaults off and requires both flags", () => {
  expect(flowEnabled(false, true)).toBe(false);
  expect(flowEnabled(true, false)).toBe(false);
  expect(flowEnabled(true, true)).toBe(true);
});

test("off has zero tracing work: no clock, native reads, buffer or ids", async () => {
  let clocks = 0, native = 0, buffers = 0;
  const trace = createFlowTrace(false, {
    now: () => { clocks++; return 1; },
    buffer: () => { buffers++; return []; },
  });
  for (let i = 0; i < 1000; i++) {
    expect(trace.begin()).toBe("");
    trace.mark("ink.down", "ignored");
    trace.markNative("ink.down", "ignored", 4000);
  }
  await trace.calibrate(() => { native++; return Promise.resolve(4000); });
  expect(trace.dump()).toEqual({ calibration: null, marks: [] });
  expect({ clocks, native, buffers }).toEqual({ clocks: 0, native: 0, buffers: 0 });
});

test("session pairs clocks once; native times are mapped, not epoch timestamps", async () => {
  let time = 10, reads = 0;
  const trace = createFlowTrace(true, { now: () => time, capacity: 2 });
  expect(trace.markNative("ink.down", "t", 1000)).toBe(false);
  await trace.calibrate(async () => { reads++; time = 14; return 1012; });
  await trace.calibrate(async () => { reads++; return 999999; });
  const id = trace.begin();
  expect(id).not.toBe("");
  expect(trace.begin()).not.toBe(id);
  expect(trace.markNative("ink.down", id, 1015)).toBe(true);
  time = 20; trace.mark("ink.up", id);
  time = 21; trace.mark("chip.paint", id);
  expect(reads).toBe(1);
  expect(trace.dump()).toEqual({
    calibration: { offsetMs: -1000, uncertaintyMs: 2 },
    marks: [
      { stage: "ink.up", trace_id: id, at: 20, generation: 0 },
      { stage: "chip.paint", trace_id: id, at: 21, generation: 0 },
    ],
  });
});

test("native calibration failures and non-finite samples never fabricate marks", async () => {
  const trace = createFlowTrace(true, { now: () => 12 });
  await trace.calibrate(async () => { throw new Error("no module"); });
  await trace.calibrate(async () => NaN);
  expect(trace.markNative("stylus.btn", "t", 1)).toBe(false);
  trace.mark("ink.up", "t", 2, NaN);
  expect(trace.dump().marks).toEqual([]);
});
