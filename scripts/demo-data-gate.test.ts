import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ROOT,
  checkRatchet,
  formatReport,
  isScannable,
  parseAllowlist,
  runGate,
  scanSource,
  scanTree,
} from "./demo-data-gate";

const FILE = "app/src/screens/Example.tsx";
const allow = (file = FILE) => ({ allowedImporters: [file] });

describe("DF-117 static import classification", () => {
  test("type-only imports and exports never count as runtime use", () => {
    const source = [
      'import type { Conversation } from "../mock/seed";',
      'import { type Fixture, type Other as Alias } from "../debug/fixture";',
      'export type { Fixture } from "../debug/fixture";',
      'export { type Seed } from "../mock/seed";',
      'type Local = import("../mock/seed").Conversation;',
    ].join("\n");
    expect(scanSource(FILE, source)).toEqual([]);
  });

  test("separates mixed type/value imports and reports imported names and line", () => {
    const source = [
      'import { type Fixture, runSeed as demo, helper } from "../mock/seed";',
      "if (__DEV__) {",
      "  demo(); helper();",
      "}",
    ].join("\n");
    const entries = scanSource(FILE, source);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      file: FILE, line: 1, specifier: "../mock/seed",
      names: ["runSeed as demo", "helper"], guarded: true,
    });
    expect(entries[0]?.sites).toEqual([{ line: 3, guarded: true }]);
    expect(checkRatchet(entries, allow()).ok).toBe(true);
  });

  test("a new importer fails; allowlisting an unguarded import does not make it safe", () => {
    const entries = scanSource(FILE, 'import { applyDemoSeed } from "../mock/seed";\napplyDemoSeed();');
    const unknown = checkRatchet(entries, { allowedImporters: [] });
    expect(unknown.ok).toBe(false);
    expect(unknown.newImporters).toMatchObject([
      { file: FILE, line: 1, specifier: "../mock/seed", names: ["applyDemoSeed"] },
    ]);
    const baseline = checkRatchet(entries, allow());
    expect(baseline.ok).toBe(false);
    expect(baseline.newImporters).toEqual([]);
    expect(baseline.unguardedAllowed[0]?.sites).toEqual([{ line: 2, guarded: false }]);
    expect(formatReport(baseline)).toContain("UNGUARDED ALLOWED IMPORT: " + FILE + ":1");
  });

  test("module side effects and unused value imports are unsafe by default", () => {
    const entries = scanSource(FILE, [
      'import "../debug/seed";',
      'import {} from "../mock/seed";',
      'import { applies } from "../mock/helpers";',
    ].join("\n"));
    expect(entries.map(item => item.names)).toEqual([
      ["(side effect)"], ["(side effect)"], ["applies"],
    ]);
    expect(entries.every(item => !item.guarded)).toBe(true);
  });

  test("a module whose name merely resembles debug or mock is not flagged", () => {
    expect(scanSource(FILE, [
      'import { foo } from "../debugging/foo";',
      'import { mockable } from "../mockable";',
      'import { x } from "real-debug-utils";',
    ].join("\n"))).toEqual([]);
  });
});

describe("DF-117 call-site guard detection", () => {
  test("recognizes if (__DEV__), __DEV__ && and isDemo flag within five lines", () => {
    const source = [
      'import { seed } from "../mock/seed";',
      'if (__DEV__) { seed(); }',
      '__DEV__ && seed();',
      'if (isDemoMode()) {',
      '  seed();',
      '}',
      'if (isDemo) seed();',
    ].join("\n");
    const imports = scanSource(FILE, source);
    expect(imports[0]?.guarded).toBe(true);
    expect(imports[0]?.sites).toEqual([
      { line: 2, guarded: true },
      { line: 3, guarded: true },
      { line: 5, guarded: true },
      { line: 7, guarded: true },
    ]);
    expect(checkRatchet(imports, allow()).ok).toBe(true);
  });

  test("one unguarded reference fails even when another is guarded", () => {
    const source = [
      'import { seed } from "../debug/seed";',
      'if (__DEV__) seed();',
      'seed();',
    ].join("\n");
    const imports = scanSource(FILE, source);
    expect(imports[0]?.sites).toEqual([
      { line: 2, guarded: true },
      { line: 3, guarded: false },
    ]);
    expect(checkRatchet(imports, allow()).unguardedAllowed).toHaveLength(1);
    expect(checkRatchet(imports, allow()).ok).toBe(false);
  });

  test("rejects negative/OR guards, unrelated comments, and a guard more than five lines away", () => {
    const source = [
      'import { seed } from "../mock/seed";',
      'if (!__DEV__) seed();',
      'if (__DEV__ || isProd) seed();',
      '// if (__DEV__) seed();',
      'seed();',
      'if (__DEV__) {',
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      '  const d = 4;',
      '  const e = 5;',
      '  seed();',
      '}',
    ].join("\n");
    expect(scanSource(FILE, source)[0]?.sites).toEqual([
      { line: 2, guarded: false },
      { line: 3, guarded: false },
      { line: 5, guarded: false },
      { line: 12, guarded: false },
    ]);
  });

  test("guards dynamic imports but not unguarded require or value re-exports", () => {
    const source = [
      'if (isDemoMode()) { void import("../mock/seed"); }',
      'const debug = require("../debug/seed");',
      'export { makeDemo } from "../mock/factory";',
      'export type { Fake } from "../mock/types";',
    ].join("\n");
    const entries = scanSource(FILE, source);
    expect(entries.map(item => [item.line, item.names[0], item.guarded])).toEqual([
      [1, "(dynamic import)", true],
      [2, "(require)", false],
      [3, "makeDemo", false],
    ]);
    expect(checkRatchet(entries, allow()).unguardedAllowed).toHaveLength(2);
  });

  test("guards are structural, not a nearby unrelated flag", () => {
    const source = [
      'import { seed } from "../mock/seed";',
      'if (__DEV__) { other(); }',
      'seed();',
      'const label = "if (__DEV__)";',
    ].join("\n");
    expect(scanSource(FILE, source)[0]?.guarded).toBe(false);
  });
});

describe("DF-117 allowlist ratchet", () => {
  test("removed importers require shrinking the allowlist; they cannot linger", () => {
    const imports = scanSource(FILE, 'import type { X } from "../mock/seed";');
    const report = checkRatchet(imports, allow());
    expect(report.ok).toBe(false);
    expect(report.staleAllowlist).toEqual([FILE]);
    expect(formatReport(report)).toContain("SHRINK ALLOWLIST");
    expect(checkRatchet(imports, { allowedImporters: [] }).ok).toBe(true);
  });

  test("rejects malformed, duplicated and out-of-scope allowlist entries", () => {
    expect(() => parseAllowlist("{}")).toThrow(/invalid/);
    expect(() => parseAllowlist('{"allowedImporters":{}}')).toThrow(/invalid/);
    expect(() => parseAllowlist('{"allowedImporters":["app/src/debug/seed.ts"]}')).toThrow(/invalid/);
    expect(() => parseAllowlist('{"allowedImporters":["app/src/X.test.ts"]}')).toThrow(/invalid/);
    expect(() => parseAllowlist(JSON.stringify({ allowedImporters: [FILE, FILE] }))).toThrow(/duplicate/);
    expect(parseAllowlist(JSON.stringify(allow()))).toEqual(allow());
  });

  test("scans only App and app/src runtime TS/TSX; skips tests and seed modules", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-demo-gate-"));
    function put(path: string, source: string): void {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, source);
    }
    try {
      put("app/App.tsx", 'import { boot } from "./src/mock/seed";\nif (__DEV__) boot();');
      put(FILE, 'import type { Seed } from "../mock/seed";');
      put("app/src/screens/Other.ts", 'import { run } from "../debug/run";\nif (isDemo) run();');
      put("app/src/screens/Other.test.ts", 'import "../mock/seed";');
      put("app/src/screens/__tests__/Unit.tsx", 'import "../mock/seed";');
      put("app/src/screens/tests/Unit.tsx", 'import "../mock/seed";');
      put("app/src/mock/seed.ts", 'import "../debug/seed";');
      put("app/src/debug/seed.ts", 'import "../mock/seed";');
      const imports = scanTree(root);
      expect(imports.map(item => item.file)).toEqual([
        "app/App.tsx", "app/src/screens/Other.ts",
      ]);
      put("scripts/demo-data-gate.allow.json",
        JSON.stringify({ allowedImporters: ["app/App.tsx", "app/src/screens/Other.ts"] }));
      expect(runGate(root).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unscreened paths", () => {
    expect(isScannable("app/App.tsx")).toBe(true);
    expect(isScannable("app/src/lib/logic.ts")).toBe(true);
    expect(isScannable("app/src/mock/seed.ts")).toBe(false);
    expect(isScannable("app/src/debug/seed.ts")).toBe(false);
    expect(isScannable("app/src/screens/__tests__/a.tsx")).toBe(false);
  });
});

// Intentional integration guard: this will fail while Hermes-owned hot files
// still use unguarded runtime seeds. It becomes green only after wiring.
// Importer inventory drift also fails even before the guard refactor.
test("live source has no unapproved or unguarded runtime seed importers", () => {
  const report = runGate(ROOT);
  expect(report.newImporters).toEqual([]);
  expect(report.staleAllowlist).toEqual([]);
  expect(report.ok).toBe(true);
});
