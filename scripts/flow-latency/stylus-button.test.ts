import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  jsToUptimeMs,
  pairWithPillCommits,
  parseButtonEdges,
  risingEdges,
  type ButtonEdge,
} from "./stylus-button";

const fixturePath = fileURLToPath(
  new URL("./fixtures/getevent-stylus-button.txt", import.meta.url),
);
const scriptPath = fileURLToPath(new URL("./stylus-button.ts", import.meta.url));
const fixture = readFileSync(fixturePath, "utf8");

function down(uptimeMs: number, code = "BTN_STYLUS"): ButtonEdge {
  return { uptimeMs, code, pressed: true };
}

describe("parseButtonEdges", () => {
  test("fixture keeps microseconds when converted to milliseconds", () => {
    const result = parseButtonEdges(fixture);
    expect(result.edges).toHaveLength(7);
    expect(result.edges[0]?.uptimeMs).toBeCloseTo(12_345_678.901, 5);
    expect(result.edges[1]?.uptimeMs).toBeCloseTo(12_345_679.001, 5);
    expect(result.edges[3]?.uptimeMs).toBeCloseTo(12_346_000.123, 5);
    expect(result.edges[4]?.uptimeMs).toBeCloseTo(12_346_005.678, 5);
    expect(result.edges[5]?.uptimeMs).toBeCloseTo(12_346_020.001, 5);
    expect(result.edges[6]?.uptimeMs).toBeCloseTo(12_346_070.123, 5);
    expect(result.edges.map((edge) => [edge.code, edge.pressed])).toEqual([
      ["BTN_STYLUS", true],
      ["BTN_STYLUS", true],
      ["BTN_STYLUS", false],
      ["BTN_STYLUS", true],
      ["BTN_STYLUS", false],
      ["BTN_STYLUS2", true],
      ["BTN_STYLUS2", false],
    ]);
    // A sync report and a volume key are valid, irrelevant events; garbage is not.
    expect(result.warnings).toEqual(["line 9: unrecognized getevent line"]);
  });

  test("code filter accepts only specified keys without warning on other valid events", () => {
    const parsed = parseButtonEdges(fixture, { codes: ["BTN_STYLUS2"] });
    expect(parsed.edges).toHaveLength(2);
    expect(parsed.edges.every((edge) => edge.code === "BTN_STYLUS2")).toBe(true);
    expect(parsed.warnings).toHaveLength(1);
    expect(parseButtonEdges(fixture, { codes: [] }).edges).toEqual([]);
  });

  test("rejects malformed timestamps and unknown selected-key values", () => {
    const parsed = parseButtonEdges(
      "[    1.1234567] /dev/input/event0: EV_KEY BTN_STYLUS DOWN\n" +
      "[    1.123456] /dev/input/event0: EV_KEY BTN_STYLUS MAYBE\n" +
      "[    1.123456] /dev/input/event0: EV_KEY BTN_STYLUS UP\n",
    );
    expect(parsed.edges).toEqual([{ uptimeMs: 1123.456, code: "BTN_STYLUS", pressed: false }]);
    expect(parsed.warnings).toEqual([
      "line 1: unrecognized getevent line",
      "line 2: invalid BTN_STYLUS value",
    ]);
  });

  test("supports CRLF, hex prefix and nonzero hex press values", () => {
    const parsed = parseButtonEdges(
      "[  12.000001] /dev/input/event12: EV_KEY BTN_STYLUS 0x00000002\r\n" +
      "[  12.000002] /dev/input/event12: EV_KEY BTN_STYLUS 0x00000000\r\n",
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.edges.map((edge) => edge.pressed)).toEqual([true, false]);
    expect(parsed.edges[0]?.uptimeMs).toBeCloseTo(12_000.001, 5);
  });
});

describe("risingEdges", () => {
  test("DOWN, DOWN, UP, DOWN produces exactly two rising edges", () => {
    const edges: ButtonEdge[] = [
      down(100),
      down(105),
      { uptimeMs: 120, code: "BTN_STYLUS", pressed: false },
      down(125),
    ];
    expect(risingEdges(edges)).toEqual([down(100), down(125)]);
    expect(edges).toHaveLength(4); // pure; no input mutation
  });

  test("tracks button codes independently across releases", () => {
    const edges: ButtonEdge[] = [
      down(100),
      down(101, "BTN_STYLUS2"),
      down(102),
      { uptimeMs: 103, code: "BTN_STYLUS2", pressed: false },
      down(104, "BTN_STYLUS2"),
    ];
    expect(risingEdges(edges)).toEqual([down(100), down(101, "BTN_STYLUS2"), down(104, "BTN_STYLUS2")]);
    expect(risingEdges(parseButtonEdges(fixture).edges)).toHaveLength(3);
  });

  test("empty and release-only inputs have no rising edges", () => {
    expect(risingEdges([])).toEqual([]);
    expect(risingEdges([
      { uptimeMs: 100, code: "BTN_STYLUS", pressed: false },
      { uptimeMs: 101, code: "BTN_STYLUS2", pressed: false },
    ])).toEqual([]);
  });

  test("a first pressed edge counts even when the log starts mid-press", () => {
    expect(risingEdges([down(2), down(3)])).toEqual([down(2)]);
  });
});

describe("pairWithPillCommits", () => {
  test("first at-or-after commit wins, with each commit used at most once", () => {
    const result = pairWithPillCommits([down(100), down(120)], [140]);
    expect(result).toEqual({ samples: [40], unmatched: 1 });
  });

  test("a commit outside the window is unmatched, but can serve a later edge", () => {
    const result = pairWithPillCommits([down(100), down(450)], [520], { windowMs: 100 });
    expect(result).toEqual({ samples: [70], unmatched: 1 });
    expect(pairWithPillCommits([down(100)], [601], { windowMs: 500 }))
      .toEqual({ samples: [], unmatched: 1 });
    expect(pairWithPillCommits([down(100)], [600], { windowMs: 500 }))
      .toEqual({ samples: [500], unmatched: 0 });
  });

  test("ignores early commits and sorts marks without changing callers' arrays", () => {
    const commits = [310, 199, 225];
    const edges = [down(300), down(200)];
    expect(pairWithPillCommits(edges, commits)).toEqual({
      samples: [25, 10],
      unmatched: 0,
    });
    expect(commits).toEqual([310, 199, 225]);
    expect(edges.map((edge) => edge.uptimeMs)).toEqual([300, 200]);
  });

  test("rejects invalid windows and non-finite timestamps", () => {
    expect(() => pairWithPillCommits([down(100)], [120], { windowMs: -1 }))
      .toThrow(/windowMs/);
    expect(() => pairWithPillCommits([down(100)], [Number.NaN]))
      .toThrow(/finite/);
    expect(() => pairWithPillCommits([down(Number.POSITIVE_INFINITY)], [120]))
      .toThrow(/finite/);
  });
});

describe("clock conversion", () => {
  test("offset is uptime minus JS clock, so a negative offset subtracts", () => {
    const jsMarkMs = 1_700_000_000_000;
    const offsetMs = 12_345 - jsMarkMs;
    expect(jsToUptimeMs(jsMarkMs, offsetMs)).toBe(12_345);
    expect(jsToUptimeMs(200, 15)).toBe(215);
  });
});

describe("CLI", () => {
  test("missing --offset-ms exits 2 before reading paths", () => {
    const result = Bun.spawnSync([
      process.execPath, scriptPath, fixturePath, "--pill", "unused-marks.json",
    ]);
    expect(result.exitCode).toBe(2);
    expect(new TextDecoder().decode(result.stderr)).toContain("--offset-ms");
  });

  test("invalid marks array exits 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-stylus-"));
    try {
      const marksPath = join(dir, "marks.json");
      writeFileSync(marksPath, '{"not":"an array"}');
      const result = Bun.spawnSync([
        process.execPath, scriptPath, fixturePath, "--pill", marksPath, "--offset-ms", "0",
      ]);
      expect(result.exitCode).toBe(2);
      expect(new TextDecoder().decode(result.stderr)).toContain("array of finite numbers");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("JSON mode pairs translated marks and reports p50/p95 without device claims", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-stylus-"));
    try {
      const marksPath = join(dir, "marks.json");
      // JS clock = uptime clock + 1000ms, hence --offset-ms -1000.
      writeFileSync(marksPath, JSON.stringify([12_346_718.901, 12_347_042.123]));
      const result = Bun.spawnSync([
        process.execPath, scriptPath, fixturePath, "--pill", marksPath,
        "--offset-ms", "-1000", "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(result.stdout));
      expect(parsed).toMatchObject({
        edges: 7,
        rising: 3,
        unmatched: 1,
        warnings: ["line 9: unrecognized getevent line"],
      });
      if (
        typeof parsed !== "object" || parsed === null ||
        !("samples" in parsed) || !Array.isArray(parsed.samples) ||
        !("p50Ms" in parsed) || typeof parsed.p50Ms !== "number" ||
        !("p95Ms" in parsed) || typeof parsed.p95Ms !== "number"
      ) {
        throw new Error("CLI did not emit samples and percentiles");
      }
      expect(parsed.samples).toHaveLength(2);
      expect(parsed.samples[0]).toBeCloseTo(40, 4);
      expect(parsed.samples[1]).toBeCloseTo(42, 4);
      expect(parsed.p50Ms).toBeCloseTo(40, 4);
      expect(parsed.p95Ms).toBeCloseTo(42, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
