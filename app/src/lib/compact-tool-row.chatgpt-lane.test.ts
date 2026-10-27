import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FormatTool } from "../../../shared/tool-format";
import { compactGroup, compactToolRow, truncateToolTarget } from "./compact-tool-row";

function tool(name: string, args: Record<string, unknown> = {}, overrides: Partial<FormatTool> = {}): FormatTool {
  return { name, args: JSON.stringify(args), output: "", status: "ok", durationMs: 420, ...overrides };
}

describe("compact tool call row (DASH-15)", () => {
  const families: {
    name: string;
    harness: string;
    args: Record<string, unknown>;
    verb: string;
    target: string;
  }[] = [
    { name: "terminal", harness: "hermes", args: { command: "bun test shared" }, verb: "Run", target: "bun test shared" },
    { name: "Bash", harness: "claude", args: { command: "git status" }, verb: "Run", target: "git status" },
    { name: "read_file", harness: "hermes", args: { path: "src/roster.ts", offset: 9, limit: 3 }, verb: "Read", target: "src/roster.ts:9–11" },
    { name: "Read", harness: "claude", args: { file_path: "src/store.ts" }, verb: "Read", target: "src/store.ts:1" },
    { name: "write_file", harness: "hermes", args: { path: "src/new.ts", content: "ok" }, verb: "Write", target: "src/new.ts" },
    { name: "patch", harness: "hermes", args: { path: "src/change.ts", old_string: "x", new_string: "y" }, verb: "Edit", target: "src/change.ts" },
    { name: "apply_patch", harness: "codex", args: { input: "*** Begin Patch\n*** Update File: src/change.ts\n-old\n+new\n*** End Patch" }, verb: "Edit", target: "src/change.ts" },
    { name: "search_files", harness: "hermes", args: { pattern: "alice", path: "src" }, verb: "Search", target: "alice · src" },
    { name: "Grep", harness: "claude", args: { pattern: "alice", path: "src" }, verb: "Search", target: "alice · src" },
    { name: "web_search", harness: "hermes", args: { query: "Expo reference" }, verb: "Web", target: "Expo reference" },
    { name: "WebFetch", harness: "claude", args: { url: "https://example.org" }, verb: "Web", target: "https://example.org" },
    { name: "delegate_task", harness: "hermes", args: { goal: "Inspect tests" }, verb: "Task", target: "Inspect tests" },
    { name: "Task", harness: "claude", args: { prompt: "Inspect tests" }, verb: "Task", target: "Inspect tests" },
  ];

  for (const sample of families) {
    test(sample.harness + "/" + sample.name + " shows one redacted formatter target with a short verb", () => {
      const row = compactToolRow(tool(sample.name, sample.args), sample.harness);
      expect(row.verb).toBe(sample.verb);
      expect(row.target).toBe(sample.target);
      expect(row.target.split("\n")).toHaveLength(1);
      expect(row.glyph.length).toBeGreaterThan(0);
      expect(row.status).toBe("ok");
      expect(row.durationLabel).toBe("420ms");
      expect(row.accessibilityLabel).toContain(sample.verb);
      expect(row.accessibilityLabel).toContain(sample.target);
    });
  }

  test("unknown tool keeps its exact name, redacted presentation and safe status", () => {
    const row = compactToolRow(tool("vendor_special", { query: "find item" }));
    expect(row.verb).toBe("vendor_special");
    expect(row.glyph).toBe("·");
    expect(row.status).toBe("ok");
    expect(row.accessibilityLabel).toContain("vendor_special");
    expect(row.target.length).toBeLessThanOrEqual(48);
    expect(compactToolRow(tool("new_status", {}, { status: "unexpected" })).status).toBe("running");
  });

  test("running and failed states are distinct; running rows never announce a duration", () => {
    const active = compactToolRow(tool("terminal", { command: "ls" }, { status: "live", durationMs: 7_000 }));
    expect(active.status).toBe("running");
    expect(active.durationLabel).toBeUndefined();
    expect(active.accessibilityLabel).toContain("running");
    expect(active.accessibilityLabel).not.toContain("7.0s");

    const failed = compactToolRow(tool("terminal", { command: "false" }, { status: "error", durationMs: 1_250 }));
    expect(failed.status).toBe("error");
    expect(failed.durationLabel).toBe("1.2s");
    expect(failed.accessibilityLabel).toContain("failed");
  });

  test("duration label boundaries: 999, 1000, 59999, 60000 ms and whole-minute padding", () => {
    const label = (ms: number) => compactToolRow(tool("terminal", { command: "x" }, { durationMs: ms })).durationLabel;
    expect(label(0)).toBe("0ms");
    expect(label(999)).toBe("999ms");
    expect(label(1_000)).toBe("1.0s");
    expect(label(4_200)).toBe("4.2s");
    expect(label(59_999)).toBe("59.9s");
    expect(label(60_000)).toBe("1m 00s");
    expect(label(185_000)).toBe("3m 05s");
    for (const bad of [-1, Number.NaN, Infinity]) expect(label(bad)).toBeUndefined();
  });

  test("a long path retains its basename and :line range at a caller-sized budget", () => {
    const path = "/very/long/path/for/another/project/with/extra/many/nested/directory/segments/roster-client.ts";
    const row = compactToolRow(tool("read_file", { path, offset: 103, limit: 7 }), "hermes", 38);
    expect(row.target.length).toBeLessThanOrEqual(38);
    expect(row.target).toContain("…/");
    expect(row.target.endsWith("roster-client.ts:103–109")).toBe(true);
    expect(row.accessibilityLabel).toContain("roster-client.ts:103–109");
    expect(compactToolRow(tool("read_file", { path, offset: 103 })).target.length).toBeLessThanOrEqual(48);
  });

  test("caller budgets truncate a non-path middle and keep targets on one line", () => {
    const target = truncateToolTarget("alpha-beta-gamma-delta", 11);
    expect(target).toBe("alpha…delta");
    expect(target.length).toBe(11);
    expect(truncateToolTarget("abcdef", 1)).toBe("…");
    expect(truncateToolTarget("/very/long/path/filename.ts:7", 2).length).toBe(2);
    const row = compactToolRow(tool("web_search", { query: "first line\nsecond line" }));
    expect(row.target.includes("\n")).toBe(false);
    expect(row.accessibilityLabel.includes("\n")).toBe(false);
  });

  test("redacts secrets before shortening; neither target nor accessible label leaks them", () => {
    const secret = "sk-abcdefghijklmnop";
    const bearer = "Bearer " + secret;
    const cases = [
      tool("read_file", { path: "/tmp/" + secret + "/config.ts", offset: 17 }),
      tool("terminal", { command: "curl -H 'Authorization: " + bearer + "' https://example.org" }),
      tool("web_search", { query: "token=" + secret + " search" }),
      tool("unknown_vendor", { target: bearer }),
      tool("read_file", { path: "/repo/.env" }, { output: "VERY_PRIVATE=do-not-expose" }),
    ];
    for (const call of cases) {
      const row = compactToolRow(call);
      expect(row.target).not.toContain(secret);
      expect(row.accessibilityLabel).not.toContain(secret);
      expect(row.target).not.toContain("do-not-expose");
      expect(row.accessibilityLabel).not.toContain("do-not-expose");
      expect(row.target.length).toBeLessThanOrEqual(48);
    }
  });
});

describe("compactGroup adjacency, identity and order", () => {
  const read = (path: string, status = "ok") => tool("read_file", { path }, { status });
  test("four consecutive reads collapse into one Read ×4 with aggregate elapsed time", () => {
    const group = compactGroup([read("src/a.ts"), read("src/b.ts"), read("src/c.ts"), read("src/d.ts")]);
    expect(group).toHaveLength(1);
    expect(group[0]?.verb).toBe("Read");
    expect(group[0]?.count).toBe(4);
    expect(group[0]?.toolIndexes).toEqual([0, 1, 2, 3]);
    expect(group[0]?.target).toBe("src/d.ts:1");
    expect(group[0]?.durationLabel).toBe("1.6s");
    expect(group[0]?.accessibilityLabel).toContain("4 successful calls");
    expect(group[0]?.accessibilityLabel).toContain("latest target src/d.ts:1");
  });

  test("an error interrupts a run of reads and remains its own row, preserving order", () => {
    const rows = compactGroup([
      read("a.ts"), read("b.ts"),
      read("failed.ts", "error"),
      read("c.ts"), read("d.ts"),
      tool("terminal", { command: "git status" }),
      read("e.ts"),
    ]);
    expect(rows.map(row => row.toolIndexes)).toEqual([[0, 1], [2], [3, 4], [5], [6]]);
    expect(rows.map(row => [row.verb, row.status, row.count ?? 1, row.target])).toEqual([
      ["Read", "ok", 2, "b.ts:1"],
      ["Read", "error", 1, "failed.ts:1"],
      ["Read", "ok", 2, "d.ts:1"],
      ["Run", "ok", 1, "git status"],
      ["Read", "ok", 1, "e.ts:1"],
    ]);
  });

  test("running calls never combine with completed calls or with each other", () => {
    const rows = compactGroup([read("a.ts"), read("running.ts", "live"), read("pending.ts", "live"), read("b.ts")]);
    expect(rows.map(row => row.status)).toEqual(["ok", "running", "running", "ok"]);
    expect(rows.every(row => row.count === undefined)).toBe(true);
    expect(rows[1]?.durationLabel).toBeUndefined();
    expect(rows[2]?.durationLabel).toBeUndefined();
    expect(compactGroup([])).toEqual([]);
  });

  test("different tool names with the same short verb can share a successful group", () => {
    const rows = compactGroup([
      read("a.ts"),
      tool("Read", { path: "b.ts" }),
      tool("web_search", { query: "today" }),
      tool("WebFetch", { url: "https://example.org" }),
    ], "claude");
    expect(rows.map(row => [row.verb, row.count])).toEqual([["Read", 2], ["Web", 2]]);
  });
});

describe("CompactToolRow source contract (Hermes wires native rendering)", () => {
  const source = readFileSync(join(import.meta.dir, "../components/CompactToolRow.tsx"), "utf8");

  test("one-line expandable button with a 44 DIP vertical hit region", () => {
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessibilityLabel={model.accessibilityLabel}");
    expect(source).toContain("onPress={onExpand}");
    expect(source).toContain("minHeight: 28");
    expect(source).toContain("hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}");
    expect(source).toContain("numberOfLines={1}");
    expect(source).toContain('ellipsizeMode="middle"');
  });

  test("uses existing palette and does not introduce an animated surface", () => {
    expect(source).toContain('from "../theme"');
    for (const token of ["colors.danger", "colors.warn", "colors.ok", "colors.text", "glass.fill"]) {
      expect(source).toContain(token);
    }
    expect(source).not.toContain("Animated.");
    expect(source).not.toContain("withTiming(");
  });
});
