import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROOT,
  checkRatchet,
  readAllowlist,
  scanSource,
  scanTree,
  shouldScanPath,
  type LoopSite,
} from "./ambient-loop-gate";

const FILE = "app/src/components/Ambient.tsx";

describe("ambient loop AST scanner", () => {
  test("an infinite withRepeat is gated by active && in its function", () => {
    const source = [
      "function Demo() {",
      "  useEffect(() => {",
      "    if (active && ready) {",
      "      progress.value = withRepeat(withTiming(1), -1);",
      "    }",
      "  }, []);",
      "}",
    ].join("\n");
    expect(scanSource(source, FILE)).toEqual([
      { file: FILE, line: 4, kind: "withRepeat", gated: true },
    ]);
  });

  test("an infinite withRepeat without an in-function gate is rejected", () => {
    const source = [
      "function Demo() {",
      "  progress.value = withRepeat(withTiming(1), -1);",
      "}",
    ].join("\n");
    const sites = scanSource(source, FILE);
    expect(sites).toEqual([
      { file: FILE, line: 2, kind: "withRepeat", gated: false },
    ]);
    expect(checkRatchet(sites, {})).toEqual([
      FILE + ": 1 ungated loop(s) exceeds allowance 0",
    ]);
  });

  test("all negative numeric counts are infinite, but zero and finite counts are not", () => {
    const source = [
      "function run() {",
      "  withRepeat(anim, -2);",
      "  withRepeat(anim, (-1));",
      "  withRepeat(anim, -count);",
      "  withRepeat(anim, -0);",
      "  withRepeat(anim, 5);",
      "}",
    ].join("\n");
    expect(scanSource(source, FILE).map(site => site.line)).toEqual([2, 3, 4]);
  });

  test("cleanup clearInterval inside the same effect marks a timer gated", () => {
    const source = [
      "function useClock() {",
      "  useEffect(() => {",
      "    const timer = setInterval(() => tick(), 1000);",
      "    return () => clearInterval(timer);",
      "  }, []);",
      "}",
    ].join("\n");
    expect(scanSource(source, FILE)).toEqual([
      { file: FILE, line: 3, kind: "setInterval", gated: true },
    ]);
  });

  test("a separate stop method cannot gate a start method", () => {
    const source = [
      "class Voice {",
      "  start() { this.timer = setInterval(() => this.poll(), 100); }",
      "  stop() { clearInterval(this.timer); }",
      "}",
    ].join("\n");
    expect(scanSource(source, "app/src/lib/voice.ts")).toEqual([
      { file: "app/src/lib/voice.ts", line: 2, kind: "setInterval", gated: false },
    ]);
  });

  test("a gate elsewhere in the file cannot silence a new interval", () => {
    const source = [
      "function unrelated() {",
      "  if (AppState.currentState === 'active') clearInterval(timer);",
      "}",
      "function poll() {",
      "  setInterval(refresh, 1000);",
      "}",
    ].join("\n");
    expect(scanSource(source, FILE)).toEqual([
      { file: FILE, line: 5, kind: "setInterval", gated: false },
    ]);
  });

  test("reduced-motion, focus and cancellation identifiers are gate signals", () => {
    const source = [
      "function loops() {",
      "  if (reduced) return;",
      "  withRepeat(anim, -1);",
      "  if (isFocused()) setInterval(poll, 1000);",
      "}",
    ].join("\n");
    expect(scanSource(source, FILE).map(site => site.gated)).toEqual([true, true]);
  });

  test("comments, strings, finite repeats and non-interval timeouts are not sites", () => {
    const source = [
      "// setInterval(hang, 1);",
      "const comment = 'withRepeat(anim, -1)';",
      "function finite() {",
      "  withRepeat(anim, 3);",
      "  setTimeout(hang, 1);",
      "}",
    ].join("\n");
    expect(scanSource(source, FILE)).toEqual([]);
  });

  test("test files, vendor and mock paths are skipped", () => {
    const source = "function run() { setInterval(fn, 100); }";
    for (const path of [
      "app/src/lib/clock.test.ts",
      "app/src/lib/clock.spec.tsx",
      "app/src/vendor/something.ts",
      "app/src/mock/data.ts",
      "app/src/__mocks__/clock.ts",
      "app/src/lib/clock.fixture.ts",
      "bridge/src/clock.ts",
    ]) {
      expect(shouldScanPath(path)).toBe(false);
      expect(scanSource(source, path)).toEqual([]);
    }
    expect(shouldScanPath("app/src/lib/clock.native.ts")).toBe(true);
    expect(shouldScanPath("app\\src\\lib\\clock.tsx")).toBe(true);
  });

  test("tree walker skips test/vendor/mock while finding production code", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-ambient-ratchet-"));
    try {
      for (const dir of ["app/src/components", "app/src/vendor", "app/src/mock"]) {
        mkdirSync(join(root, dir), { recursive: true });
      }
      const source = "function run() { setInterval(fn, 100); }\n";
      writeFileSync(join(root, "app/src/components/clock.ts"), source);
      writeFileSync(join(root, "app/src/components/clock.test.ts"), source);
      writeFileSync(join(root, "app/src/vendor/clock.ts"), source);
      writeFileSync(join(root, "app/src/mock/clock.ts"), source);
      expect(scanTree(root)).toEqual([
        { file: "app/src/components/clock.ts", line: 1, kind: "setInterval", gated: false },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("per-file ratchet", () => {
  const site: LoopSite = { file: FILE, line: 2, kind: "setInterval", gated: false };

  test("over-allowance fails with the file and observed count", () => {
    expect(checkRatchet([site, site], { [FILE]: 1 })).toEqual([
      FILE + ": 2 ungated loop(s) exceeds allowance 1",
    ]);
  });

  test("new files default to zero allowance", () => {
    expect(checkRatchet([site], {})).toEqual([
      FILE + ": 1 ungated loop(s) exceeds allowance 0",
    ]);
  });

  test("under-allowance requires lowering the number, including for removed files", () => {
    expect(checkRatchet([site], { [FILE]: 2 })).toEqual([
      FILE + ": 1 ungated loop(s) is below allowance 2; lower the number to 1",
    ]);
    expect(checkRatchet([], { [FILE]: 1 })).toEqual([
      FILE + ": 0 ungated loop(s) is below allowance 1; lower the number to 0",
    ]);
  });

  test("gated sites do not spend allowance", () => {
    expect(checkRatchet([{ ...site, gated: true }], {})).toEqual([]);
    expect(checkRatchet([site], { [FILE]: 1 })).toEqual([]);
  });

  test("checked-in app source matches the exact shrinking baseline", () => {
    const sites = scanTree(ROOT);
    const allowances = readAllowlist(join(ROOT, "scripts", "ambient-loop-gate.allow.json"));
    expect(checkRatchet(sites, allowances)).toEqual([]);
  });
});
