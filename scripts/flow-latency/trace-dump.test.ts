import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDumpFile,
  pairSamples,
  parseFlowDump,
  type FlowDump,
  type StagePair,
} from "./trace-dump";

const fixturePath = fileURLToPath(new URL("./fixtures/flow-dump-sample.json", import.meta.url));
const scriptPath = fileURLToPath(new URL("./trace-dump.ts", import.meta.url));
const loaderPair: StagePair = {
  id: "commit-loader", start: ["turn.commit"], end: "genui.loader",
};

function fixture(): FlowDump {
  const result = loadDumpFile(fixturePath);
  if (!result.ok) throw new Error(result.error);
  return result.dump;
}

describe("Flow trace dump parsing", () => {
  test("accepts and preserves the three-turn fixture", () => {
    const dump = fixture();
    expect(dump.marks).toHaveLength(13);
    expect(dump.calibration).toEqual({ offsetMs: 12.5, uncertaintyMs: 0.4 });
    expect(new Set(dump.marks.map(mark => mark.trace_id)).size).toBe(3);
  });

  test("rejects malformed fields without throwing or returning samples", () => {
    const good = { stage: "turn.commit", trace_id: "turn-a", at: 10, generation: 0 };
    const invalid: { name: string; raw: unknown; message: RegExp }[] = [
      { name: "object", raw: null, message: /object/ },
      { name: "marks", raw: { calibration: null }, message: /marks/ },
      { name: "calibration", raw: { calibration: { offsetMs: 2 }, marks: [] }, message: /calibration/ },
      { name: "non-finite calibration", raw: { calibration: { offsetMs: 0, uncertaintyMs: NaN }, marks: [] }, message: /calibration/ },
      { name: "stage", raw: { calibration: null, marks: [{ ...good, stage: "bad-stage" }] }, message: /stage/ },
      { name: "generation", raw: { calibration: null, marks: [{ ...good, generation: -1 }] }, message: /generation/ },
      { name: "unsafe generation", raw: { calibration: null, marks: [{ ...good, generation: Number.MAX_SAFE_INTEGER + 1 }] }, message: /generation/ },
      { name: "empty trace", raw: { calibration: null, marks: [{ ...good, trace_id: "" }] }, message: /trace_id/ },
      { name: "blank trace", raw: { calibration: null, marks: [{ ...good, trace_id: "   " }] }, message: /trace_id/ },
      { name: "long trace", raw: { calibration: null, marks: [{ ...good, trace_id: "x".repeat(65) }] }, message: /trace_id/ },
      { name: "non-finite timestamp", raw: { calibration: null, marks: [{ ...good, at: Infinity }] }, message: /\.at/ },
      { name: "missing calibration", raw: { marks: [good] }, message: /calibration/ },
    ];
    for (const row of invalid) {
      expect(() => parseFlowDump(row.raw)).not.toThrow();
      const result = parseFlowDump(row.raw);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unexpected parse success for " + row.name);
      expect(result.error).toMatch(row.message);
    }
  });

  test("rejects invalid JSON through the file loader", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-dump-"));
    try {
      const path = join(dir, "bad.json");
      writeFileSync(path, "{\"marks\":");
      expect(loadDumpFile(path)).toEqual({ ok: false, error: "invalid JSON dump" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("one stage-pair sample per turn", () => {
  test("fixture yields hand-computed samples and exactly one unmatched start", () => {
    const result = pairSamples(fixture(), [loaderPair]);
    expect(result.samples.get(loaderPair.id)).toEqual([25, 45]);
    expect(result.unmatched.get(loaderPair.id)).toBe(1);
    expect(result.skippedUncalibrated).toBe(0);
  });

  test("pairs out-of-order marks by timestamp and checks end generation", () => {
    const raw: unknown = {
      calibration: null,
      marks: [
        { stage: "ack.paint", trace_id: "x", at: 23, generation: 2 },
        { stage: "input.touch", trace_id: "x", at: 12, generation: 2 },
        { stage: "ack.paint", trace_id: "x", at: 16, generation: 1 },
        { stage: "input.pen", trace_id: "x", at: 5, generation: 2 },
        { stage: "ack.paint", trace_id: "x", at: 3, generation: 2 },
      ],
    };
    const parsed = parseFlowDump(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const pairs: readonly StagePair[] = [{
      id: "input-ack", start: ["input.touch", "input.pen"], end: "ack.paint",
    }];
    const result = pairSamples(parsed.dump, pairs);
    expect(result.samples.get("input-ack")).toEqual([18]);
    expect(result.unmatched.get("input-ack")).toBe(0);
  });

  test("native pairs require calibration but JS pairs still work without it", () => {
    const dump = fixture();
    const native: StagePair = {
      id: "pen-frame", start: ["ink.down"], end: "ink.frame", native: true,
    };
    const calibrated = pairSamples(dump, [native]);
    expect(calibrated.samples.get(native.id)).toEqual([16]);
    expect(calibrated.skippedUncalibrated).toBe(0);

    const uncalibrated = pairSamples({ ...dump, calibration: null }, [native, loaderPair]);
    expect(uncalibrated.samples.get(native.id)).toEqual([]);
    expect(uncalibrated.unmatched.get(native.id)).toBe(0);
    expect(uncalibrated.skippedUncalibrated).toBe(1);
    expect(uncalibrated.samples.get(loaderPair.id)).toEqual([25, 45]);
    expect(uncalibrated.unmatched.get(loaderPair.id)).toBe(1);
  });

  test("does not record non-finite duration even with finite timestamp inputs", () => {
    const parsed = parseFlowDump({
      calibration: null,
      marks: [
        { stage: "turn.commit", trace_id: "large", at: -1e308, generation: 0 },
        { stage: "genui.loader", trace_id: "large", at: 1e308, generation: 0 },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const result = pairSamples(parsed.dump, [loaderPair]);
    expect(result.samples.get(loaderPair.id)).toEqual([]);
    expect(result.unmatched.get(loaderPair.id)).toBe(1);
  });
});

describe("trace-dump CLI", () => {
  test("prints structured samples for a valid JSON fixture", () => {
    const run = Bun.spawnSync([process.execPath, scriptPath, fixturePath, "--json"]);
    expect(run.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(run.stdout);
    expect(stdout).toContain('"id": "commit-to-loader"');
    expect(stdout).toContain('"skippedUncalibrated": 0');
  });

  test("exits 2 for a non-JSON input file", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-dump-cli-"));
    try {
      const path = join(dir, "bad.json");
      writeFileSync(path, "not JSON");
      const run = Bun.spawnSync([process.execPath, scriptPath, path]);
      expect(run.exitCode).toBe(2);
      expect(new TextDecoder().decode(run.stderr)).toContain("invalid JSON dump");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
