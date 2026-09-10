import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutant, collectMutants, ROOT, TARGETS } from "./mutate";

describe("collectMutants", () => {
  test("mutates numeric constants that lock UI geometry", () => {
    const source = "export const NAV_CHROME_HEIGHT = 60;\nexport const ON = true;\n";
    const mutants = collectMutants(source, "nav.ts");
    expect(mutants.some((m) => m.original === "60" && m.replacement === "61")).toBe(true);
    expect(mutants.some((m) => m.original === "true" && m.replacement === "false")).toBe(true);
  });

  test("does not mutate equivalent operators inside functions", () => {
    const source = "export const ok = (n: number) => n < 2 && n === 0;\n";
    const mutants = collectMutants(source, "cmp.ts");
    expect(mutants.some((m) => m.original === "===")).toBe(false);
    expect(mutants.some((m) => m.original === "&&")).toBe(false);
  });

  test("does not mutate numbers inside strings or comments", () => {
    const source = "// height 60\nconst css = \"height: 60px\";\nexport const n = 60;\n";
    const mutants = collectMutants(source, "skip.ts");
    expect(mutants.filter((m) => m.original === "60")).toHaveLength(1);
  });

  test("applyMutant replaces only the targeted span", () => {
    const source = "export const a = 60; export const b = 60;";
    const first = collectMutants(source, "x.ts")[0];
    expect(first).toBeDefined();
    if (!first) return;
    const next = applyMutant(source, first);
    expect(next).toContain("export const a = 61");
    expect(next).toContain("const b = 60");
  });
});

describe("targets", () => {
  test("covers the modules that accidentally mutated UI or protocol", () => {
    expect(TARGETS.map((t) => t.file)).toEqual([
      "app/src/components/golden-nav.ts",
      "app/src/components/bridge-pull.ts",
      "app/src/motion.ts",
      "shared/protocol.ts",
      "bridge/src/roster.ts",
    ]);
  });

  test("chrome height 60 is in the golden-nav mutant set", async () => {
    const source = await Bun.file(join(ROOT, "app/src/components/golden-nav.ts")).text();
    const mutants = collectMutants(source, "app/src/components/golden-nav.ts");
    expect(mutants.some((m) => m.original === "60")).toBe(true);
  });
});

describe("kill canary", () => {
  test("a fixture pin kills HEIGHT 60 → 61", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-mutate-"));
    mkdirSync(dir, { recursive: true });
    const srcPath = join(dir, "height.ts");
    const testPath = join(dir, "height.test.ts");
    writeFileSync(srcPath, "export const HEIGHT = 60;\n");
    writeFileSync(
      testPath,
      'import { expect, test } from "bun:test";\nimport { HEIGHT } from "./height";\ntest("pin", () => expect(HEIGHT).toBe(60));\n',
    );
    const source = "export const HEIGHT = 60;\n";
    const mutant = collectMutants(source, "height.ts").find((m) => m.original === "60");
    expect(mutant).toBeDefined();
    if (!mutant) return;
    writeFileSync(srcPath, applyMutant(source, mutant));
    const proc = Bun.spawn(["bun", "test", testPath], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    expect(code).not.toBe(0);
  });
});
