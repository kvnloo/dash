import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const BUG_CLASSES = [
  "layout geometry",
  "protocol/bridge contract",
  "lifecycle/teardown",
  "state persistence across reload",
  "platform back/navigation",
  "native module/bundle",
  "accessibility",
  "frame-time/jank",
  "race/reconciliation",
];
const KNOWN_CLASSES = new Set(BUG_CLASSES);
const SOURCE_REFERENCE = /(?:#[1-9]\d*\b|https:\/\/github\.com\/[^\s)]+)/;
const SEPARATOR = /^:?-{3,}:?$/;

/** Split a Markdown row with optional boundary pipes, respecting escaped pipes. */
function tableCells(source: string): string[] | null {
  const body = source.trim();
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i] ?? "";
    if (char === "\\" && body[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  // No unescaped delimiter means this is prose, not a table row.
  if (cells.length === 0) return null;
  cells.push(cell.trim());
  if (body.startsWith("|")) cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** Pure checker: checks every data row in every Markdown table, including the summary. */
export function checkRootCauseDoc(markdown: string): string[] {
  const errors: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let tables = 0;
  let fenced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const header = tableCells(line);
    const separator = tableCells(lines[i + 1] ?? "");
    if (!header || !separator || header.length !== separator.length ||
      !separator.every(cell => SEPARATOR.test(cell))) continue;

    tables += 1;
    const classAt = header.indexOf("Bug class");
    const gateAt = header.findIndex(cell => cell === "Missing gate" || cell.startsWith("Missing gate ("));
    if (classAt < 0 || gateAt < 0) {
      errors.push(`table at line ${i + 1}: missing Bug class or Missing gate column`);
    }
    let count = 0;
    let next = i + 2;
    for (; next < lines.length; next++) {
      const cells = tableCells(lines[next] ?? "");
      if (!cells) break;
      count += 1;
      if (cells.length !== header.length) {
        errors.push(`line ${next + 1}: expected ${header.length} table cells, got ${cells.length}`);
      }
      if (classAt >= 0) {
        const name = cells[classAt] ?? "";
        if (!KNOWN_CLASSES.has(name)) {
          errors.push(`line ${next + 1}: unknown bug class "${name}"`);
        }
      }
      if (!SOURCE_REFERENCE.test(cells.join(" "))) {
        errors.push(`line ${next + 1}: missing PR/issue reference`);
      }
      if (gateAt >= 0 && !(cells[gateAt] ?? "").trim()) {
        errors.push(`line ${next + 1}: missing proposed gate`);
      }
    }
    if (count === 0) errors.push(`table at line ${i + 1}: no data rows`);
    i = next - 1;
  }

  if (tables === 0) errors.push("document has no Markdown tables");
  return errors;
}

function rowsUnder(markdown: string, heading: string): string[][] {
  const section = markdown.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
  const lines = section.split("\n");
  const at = lines.findIndex(line => line.trim().startsWith("| Bug class |"));
  if (at < 0) return [];
  const rows: string[][] = [];
  for (let i = at + 2; i < lines.length; i++) {
    const cells = tableCells(lines[i] ?? "");
    if (!cells) break;
    rows.push(cells);
  }
  return rows;
}

const GOOD = [
  "| Bug class | PR/issue link | Missing gate |",
  "| --- | --- | --- |",
  "| accessibility | [#340](https://github.com/kvnloo/dash/pull/340) | A: rendered check in .maestro/a11y-voice.yaml |",
].join("\n");
const DOC = readFileSync(new URL("../docs/ROOT-CAUSE.md", import.meta.url), "utf8");

describe("checkRootCauseDoc (pure)", () => {
  test("accepts a small table and escaped pipe cells without changing its input", () => {
    expect(checkRootCauseDoc(GOOD)).toEqual([]);
    const withPipe = GOOD.replace("A: rendered check", "A: label \\| role rendered check");
    expect(checkRootCauseDoc(withPipe)).toEqual([]);
    expect(GOOD).toContain("[#340]");
  });

  for (const leading of ["", "|"]) {
    for (const trailing of ["", "|"]) {
      const row = (cells: string) => `${leading} ${cells} ${trailing}`.trim();
      const header = [row("Bug class | PR/issue link | Missing gate"), row("--- | --- | ---")];
      const valid = row("accessibility | #340 | rendered check");
      test(`validates every row with boundary pipes ${JSON.stringify([leading, trailing])}`, () => {
        expect(checkRootCauseDoc([...header, valid].join("\n"))).toEqual([]);
        for (const [bad, error] of [
          [row("performance | #340 | rendered check"), "unknown bug class"],
          [row("accessibility | no source | rendered check"), "missing PR/issue reference"],
          [`${leading} accessibility | #340 |   |`, "missing proposed gate"],
        ]) {
          expect(checkRootCauseDoc([...header, valid, bad ?? "", valid].join("\n")))
            .toContainEqual(expect.stringContaining(error ?? ""));
        }
      });
    }
  }

  test("validates unbordered rows inside a bordered table", () => {
    const invalid = "performance | no source |   |";
    const errors = checkRootCauseDoc(`${GOOD}\n${invalid}\n${GOOD.split("\n")[2]}`);
    expect(errors).toContainEqual(expect.stringContaining("unknown bug class"));
    expect(errors).toContainEqual(expect.stringContaining("missing PR/issue reference"));
    expect(errors).toContainEqual(expect.stringContaining("missing proposed gate"));
  });

  test("preserves an escaped final pipe in an unbordered gate cell", () => {
    expect(checkRootCauseDoc("Bug class | PR/issue link | Missing gate\n--- | --- | ---\naccessibility | #340 | \\|")).toEqual([]);
  });

  test("rejects an unknown class", () => {
    expect(checkRootCauseDoc(GOOD.replace("| accessibility |", "| performance |")))
      .toContainEqual(expect.stringContaining("unknown bug class"));
  });

  test("rejects rows without a PR/issue link or #number", () => {
    expect(checkRootCauseDoc(GOOD.replace("[#340](https://github.com/kvnloo/dash/pull/340)", "no source")))
      .toContainEqual(expect.stringContaining("missing PR/issue reference"));
  });

  test("rejects a missing proposed gate", () => {
    expect(checkRootCauseDoc(GOOD.replace("A: rendered check in .maestro/a11y-voice.yaml", "")))
      .toContainEqual(expect.stringContaining("missing proposed gate"));
  });

  test("checks summary rows too, and rejects malformed table width", () => {
    const summary = [
      "| Bug class | Count | Missing gate | Tracking issue | Evidence refs |",
      "| --- | --- | --- | --- | --- |",
      "| frame-time/jank | 1 | C: frame trace scripts/assert-frame-times.ts | [#344](https://github.com/kvnloo/dash/issues/344) | #344 |",
    ].join("\n");
    expect(checkRootCauseDoc(summary)).toEqual([]);
    expect(checkRootCauseDoc(summary.replace(" | #344 |", " |")))
      .toContainEqual(expect.stringContaining("expected 5 table cells"));
    expect(checkRootCauseDoc(summary.replace("scripts/assert-frame-times.ts", ""))).toEqual([]);
    expect(checkRootCauseDoc(summary.replace("C: frame trace ", "").replace("scripts/assert-frame-times.ts", "")))
      .toContainEqual(expect.stringContaining("missing proposed gate"));
  });

  test("rejects missing or empty tables", () => {
    expect(checkRootCauseDoc("No table here.")).toContain("document has no Markdown tables");
    expect(checkRootCauseDoc("| Bug class | Missing gate |\n| --- | --- |"))
      .toContainEqual(expect.stringContaining("no data rows"));
  });
});

describe("real ROOT-CAUSE.md", () => {
  test("both evidence and summary tables have valid classes, refs and missing gates", () => {
    expect(checkRootCauseDoc(DOC)).toEqual([]);
  });

  test("covers each of 13 specified PRs and 17 issues exactly once in the evidence ledger", () => {
    const rows = rowsUnder(DOC, "Per-item evidence ledger");
    const prs = [13, 34, 42, 72, 85, 309, 313, 323, 328, 337, 338, 340, 342];
    const issues = [344, 187, 143, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169];
    expect(rows).toHaveLength(prs.length + issues.length);
    for (const id of prs) {
      const ref = `[#${id}](https://github.com/kvnloo/dash/pull/${id})`;
      expect(rows.filter(row => row[1] === ref), `PR #${id} ledger count`).toHaveLength(1);
    }
    for (const id of issues) {
      const ref = `[#${id}](https://github.com/kvnloo/dash/issues/${id})`;
      expect(rows.filter(row => row[1] === ref), `issue #${id} ledger count`).toHaveLength(1);
    }
    const headers = DOC.split("## Per-item evidence ledger\n")[1]?.split("\n").find(line => line.startsWith("| Bug class")) ?? "";
    expect(headers).toContain("Evidence (reported or changed)");
    expect(headers).toContain("Inference");
    expect(headers).toContain("How found");
  });

  test("summary counts agree with one primary class per ledger item", () => {
    const ledger = rowsUnder(DOC, "Per-item evidence ledger");
    const summary = rowsUnder(DOC, "Bug-class summary");
    expect(summary).toHaveLength(BUG_CLASSES.length);
    const classCounts = new Map<string, number>(BUG_CLASSES.map(name => [name, ledger.filter(row => row[0] === name).length]));
    for (const row of summary) {
      const name = row[0] ?? "";
      expect(BUG_CLASSES).toContain(name);
      expect(classCounts.get(name)).toBe(Number(row[1]));
    }
    expect(classCounts.get("accessibility")).toBe(16);
    expect([...classCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(30);
    expect(DOC).toContain("A — rendered/native accessibility journeys: 16 items");
    expect(DOC).toContain("C — actual native app/device journeys and trace gates: 10 items");
    expect(DOC).toContain("B — paired bridge/contract/reconciliation integration fixtures: 4 items");
  });
});
