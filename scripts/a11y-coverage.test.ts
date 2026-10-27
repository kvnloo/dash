import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROOT,
  buildBaseline,
  checkRatchet,
  formatReport,
  parseBaseline,
  runCoverage,
  scanSource,
  scanTree,
  type Finding,
} from "./a11y-coverage";

const FILE = "app/src/components/Example.tsx";

function finding(line: number, file = FILE, label = false, spreadProps = false): Finding {
  return { file, line, component: "Pressable", hasLabel: label, hasRole: true, spreadProps };
}

describe("scanSource JSX openings", () => {
  test("handles labels, roles, nested >, prop spreads, all touchables and animated aliases", () => {
    const source = [
      "const MotionPressable = Animated.createAnimatedComponent(Pressable);",
      'const ignored = "<Pressable />";',
      "/* <TouchableHighlight /> */",
      '<Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} />',
      "<Pressable",
      "  onPress={() => { if (a > b) x(); }}",
      '  accessibilityRole="button"',
      "/>",
      '<TouchableOpacity accessibilityRole="button" {...props} />',
      "<TouchableHighlight accessibilityLabel={label} onPress={tap} />",
      "<TouchableWithoutFeedback onPress={tap} />",
      "<Switch value={enabled} />",
      '<Animated.Pressable accessibilityLabel="Animate" />',
      '<MotionPressable accessibilityRole="button" onPress={tap} />',
      '<Pressable onPress={() => log(\x60count \x24{count > 1 ? ">" : "<"}\x60)} />',
      '<Pressable onPress={() => log("accessibilityLabel inside expression is not an attribute")} />',
      "</Pressable>",
    ].join("\n");

    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 4, component: "Pressable", hasLabel: true, hasRole: true, spreadProps: false },
      { file: FILE, line: 5, component: "Pressable", hasLabel: false, hasRole: true, spreadProps: false },
      { file: FILE, line: 9, component: "TouchableOpacity", hasLabel: false, hasRole: true, spreadProps: true },
      { file: FILE, line: 10, component: "TouchableHighlight", hasLabel: true, hasRole: false, spreadProps: false },
      { file: FILE, line: 11, component: "TouchableWithoutFeedback", hasLabel: false, hasRole: false, spreadProps: false },
      { file: FILE, line: 12, component: "Switch", hasLabel: false, hasRole: false, spreadProps: false },
      { file: FILE, line: 13, component: "Animated.Pressable", hasLabel: true, hasRole: false, spreadProps: false },
      { file: FILE, line: 14, component: "MotionPressable", hasLabel: false, hasRole: true, spreadProps: false },
      { file: FILE, line: 15, component: "Pressable", hasLabel: false, hasRole: false, spreadProps: false },
      { file: FILE, line: 16, component: "Pressable", hasLabel: false, hasRole: false, spreadProps: false },
    ]);
  });

  test("finds attributes after nested template and brace expressions, but not in expressions", () => {
    const source = [
      "<Pressable",
      "  onPress={() => {",
      '    const message = \x60before \x24{count > 1 ? \x60inner >\x60 : "below"} after\x60;',
      "    if (count > 3) send(message);",
      "  }}",
      '  accessibilityLabel={\x60Send \x24{count > 0 ? "now" : "later"}\x60}',
      '  accessibilityRole="button"',
      "/>",
      '<Pressable onPress={() => log("accessibilityLabel")} />',
      '<Pressable {...options} accessibilityLabel="Named" />',
    ].join("\n");

    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 1, component: "Pressable", hasLabel: true, hasRole: true, spreadProps: false },
      { file: FILE, line: 9, component: "Pressable", hasLabel: false, hasRole: false, spreadProps: false },
      { file: FILE, line: 10, component: "Pressable", hasLabel: true, hasRole: false, spreadProps: true },
    ]);
  });

  test("skips comments, quoted examples, closing tags and unrelated custom components", () => {
    const source = [
      "// <Pressable onPress={onPress} />",
      "/*",
      "<Switch />",
      "*/",
      'const example = "<TouchableOpacity />";',
      "<MyPressable />",
      "</Pressable>",
      "<Pressable />",
    ].join("\n");
    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 8, component: "Pressable", hasLabel: false, hasRole: false, spreadProps: false },
    ]);
  });
});

describe("JSX text and nested touchable regression coverage", () => {
  test("finds touchables after apostrophes and quoted punctuation in JSX text", () => {
    const source = [
      "const view = (",
      "  <View>",
      "    <Text>Don't miss a user's action; quoted \"words\" and // comments are text.</Text>",
      "    <Text>A backtick \x60 here is also JSX text.</Text>",
      '    <Pressable accessibilityRole="button" onPress={tap} />',
      '    <TouchableOpacity accessibilityLabel="Close" />',
      "  </View>",
      ");",
      "const notAControl = '<Pressable />';",
      "<Switch />",
    ].join("\n");
    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 5, component: "Pressable", hasLabel: false, hasRole: true, spreadProps: false },
      { file: FILE, line: 6, component: "TouchableOpacity", hasLabel: true, hasRole: false, spreadProps: false },
      { file: FILE, line: 10, component: "Switch", hasLabel: false, hasRole: false, spreadProps: false },
    ]);
    const report = checkRatchet(scanSource(FILE, source), { unlabeled: {} });
    expect(report.ok).toBe(false);
    expect(report.increases).toEqual([{ file: FILE, line: 5, previous: 0, current: 2 }]);
  });

  test("finds JSX touchables nested within another target's attribute expressions", () => {
    const source = [
      "const ui = (",
      '  <Pressable accessibilityRole="button"',
      '    child={<TouchableOpacity accessibilityLabel="Nested only" />}',
      '    render={() => <Animated.Pressable onPress={tap} />}',
      '    details={{ value: () => <Switch accessibilityRole="switch" /> }}',
      '    onPress={() => { if (a > b) tap(); }}',
      "  />",
      ");",
      'const other = <View trailing={() => (<TouchableHighlight {...rest} />)} />;',
    ].join("\n");
    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 2, component: "Pressable", hasLabel: false, hasRole: true, spreadProps: false },
      { file: FILE, line: 3, component: "TouchableOpacity", hasLabel: true, hasRole: false, spreadProps: false },
      { file: FILE, line: 4, component: "Animated.Pressable", hasLabel: false, hasRole: false, spreadProps: false },
      { file: FILE, line: 5, component: "Switch", hasLabel: false, hasRole: true, spreadProps: false },
      { file: FILE, line: 9, component: "TouchableHighlight", hasLabel: false, hasRole: false, spreadProps: true },
    ]);
    const report = checkRatchet(scanSource(FILE, source), { unlabeled: {} });
    expect(report.ok).toBe(false);
    expect(report.unlabeled).toEqual({ [FILE]: 3 });
    expect(report.spreadProps).toEqual([
      { file: FILE, line: 9, component: "TouchableHighlight", hasLabel: false, hasRole: false, spreadProps: true },
    ]);
  });

  test("finds text after contractions in lower-case JSX hosts, not JS comparisons", () => {
    const source = [
      "const condition = a < bound && result > other;",
      "const generic = pick<Pressable>(value);",
      "const ui = <div>It's JSX text, not a quote. <Pressable /></div>;",
      "const nested = <Text><span>Don't skip <Switch accessibilityLabel='Enabled' /></span></Text>;",
      'const ignored = "<TouchableOpacity />";',
    ].join("\n");
    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 3, component: "Pressable", hasLabel: false, hasRole: false, spreadProps: false },
      { file: FILE, line: 4, component: "Switch", hasLabel: true, hasRole: false, spreadProps: false },
    ]);
  });

  test("visits JSX in template interpolations without scanning literal template text", () => {
    const source = [
      'const interpolated = \x60ready: \x24{ready ? <Pressable accessibilityLabel="Go" /> : null}\x60;',
      'const literal = \x60<Switch />\x60;',
      "const content = <Text>It's readable <Switch /></Text>;",
    ].join("\n");
    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 1, component: "Pressable", hasLabel: true, hasRole: false, spreadProps: false },
      { file: FILE, line: 3, component: "Switch", hasLabel: false, hasRole: false, spreadProps: false },
    ]);
  });
});

describe("JavaScript lexical context regressions", () => {
  test("comments preserve the preceding expression context", () => {
    const source = [
      'const first = /* note */ <Pressable />;',
      'function render() { return /* note */ <View>Don\'t hide <Switch /></View>; }',
      'const second = // note with an apostrophe\n<TouchableOpacity />;',
      'const nested = <View child={/* note */ <TouchableHighlight />} />;',
      'const comparison = value /* note */ < bound && other > limit;',
    ].join("\n");
    expect(scanSource(FILE, source).map(f => [f.line, f.component])).toEqual([
      [1, "Pressable"], [2, "Switch"], [4, "TouchableOpacity"], [5, "TouchableHighlight"],
    ]);
    expect(checkRatchet(scanSource(FILE, source), { unlabeled: {} }).increases).toEqual([
      { file: FILE, line: 1, previous: 0, current: 4 },
    ]);
  });

  test("regex quotes, braces, escapes and character classes cannot hide or invent controls", () => {
    const source = [
      "const quote = /'/; const first = <Pressable />;",
      'const doubleQuote = /"/; const second = <Switch />;',
      'const pattern = /<Pressable \\/>|[}/]/g; const third = <TouchableOpacity />;',
      'const nested = <Pressable onPress={() => /[}]/.test(value)} accessibilityLabel="Outer" child={<Switch />} />;',
      'function render() { if (ready) /[\x60]/.test(value); return /* note */ <TouchableHighlight />; }',
      'const divided = total / count / scale; const fourth = <TouchableWithoutFeedback />;',
      'const more = <View>{/}/.test(value) ? <Pressable /> : null}</View>;',
    ].join("\n");
    expect(scanSource(FILE, source).map(f => [f.line, f.component, f.hasLabel])).toEqual([
      [1, "Pressable", false], [2, "Switch", false], [3, "TouchableOpacity", false],
      [4, "Pressable", true], [4, "Switch", false], [5, "TouchableHighlight", false],
      [6, "TouchableWithoutFeedback", false], [7, "Pressable", false],
    ]);
    expect(checkRatchet(scanSource(FILE, source), { unlabeled: {} }).unlabeled).toEqual({ [FILE]: 7 });
  });
});

describe("per-file accessibility ratchet", () => {
  test("increasing the count fails with a file and new finding line", () => {
    const report = checkRatchet([finding(3), finding(22)], { unlabeled: { [FILE]: 1 } });
    expect(report.ok).toBe(false);
    expect(report.increases).toEqual([{ file: FILE, line: 22, previous: 1, current: 2 }]);
    expect(formatReport(report)).toContain(FILE + ":22");
    expect(formatReport(report)).toContain("ratchet regression");
  });

  test("equal counts pass, lower counts pass with ratchet-down guidance", () => {
    const baseline = { unlabeled: { [FILE]: 1 } };
    const equal = checkRatchet([finding(9)], baseline);
    expect(equal.ok).toBe(true);
    expect(equal.decreases).toEqual([]);
    const lower = checkRatchet([finding(9, FILE, true)], baseline);
    expect(lower.ok).toBe(true);
    expect(lower.decreases).toEqual([{ file: FILE, previous: 1, current: 0 }]);
    expect(formatReport(lower)).toContain("ratchet down: " + FILE + " 1 -> 0");
  });

  test("new files default to zero and fail on unlabeled touchables", () => {
    const added = "app/src/screens/NewScreen.tsx";
    const report = checkRatchet([finding(7, added)], { unlabeled: { [FILE]: 1 } });
    expect(report.ok).toBe(false);
    expect(report.increases).toEqual([{ file: added, line: 7, previous: 0, current: 1 }]);
  });

  test("prop-spread controls are reported separately and not counted as unlabeled", () => {
    const findings = [finding(2, FILE, false, true), finding(5, FILE, true)];
    const report = checkRatchet(findings, { unlabeled: {} });
    expect(report.ok).toBe(true);
    expect(report.spreadProps).toEqual([finding(2, FILE, false, true)]);
    expect(report.unlabeled).toEqual({});
    expect(formatReport(report)).toContain("spread props (review separately): " + FILE + ":2");
    expect(buildBaseline([finding(4), ...findings])).toEqual({ unlabeled: { [FILE]: 1 } });
  });

  test("rejects malformed baseline maps, negative and fractional budgets", () => {
    expect(() => parseBaseline("{}")).toThrow(/missing unlabeled/);
    expect(() => parseBaseline('{"unlabeled": []}')).toThrow(/must be a map/);
    expect(() => parseBaseline('{"unlabeled": {"app/src/Bad.tsx": -1}}')).toThrow(/invalid/);
    expect(() => parseBaseline('{"unlabeled": {"app/src/Bad.tsx": 0.5}}')).toThrow(/invalid/);
  });
});

describe("scanTree and baseline CLI core", () => {
  test("walks TSX and ignores test, vendor, mock directories and file suffixes", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-a11y-"));
    function put(path: string, text: string): void {
      const full = join(root, "app", "src", path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, text);
    }
    try {
      put("components/Action.tsx", '<Pressable />\n<Switch accessibilityLabel="Toggle" />');
      put("components/Action.test.tsx", "<Pressable />");
      put("components/Action.spec.tsx", "<Pressable />");
      put("components/Action.ts", "<Pressable />");
      put("components/__tests__/Invisible.tsx", "<Pressable />");
      put("vendor/External.tsx", "<Pressable />");
      put("mock/Fake.tsx", "<Pressable />");
      const findings = scanTree(root);
      expect(findings).toEqual([
        { file: "app/src/components/Action.tsx", line: 1, component: "Pressable", hasLabel: false, hasRole: false, spreadProps: false },
        { file: "app/src/components/Action.tsx", line: 2, component: "Switch", hasLabel: true, hasRole: false, spreadProps: false },
      ]);

      expect(runCoverage(root, true).ok).toBe(true);
      const raw = readFileSync(join(root, "scripts/a11y-coverage.baseline.json"), "utf8");
      expect(parseBaseline(raw)).toEqual({ unlabeled: { "app/src/components/Action.tsx": 1 } });
      expect(runCoverage(root).ok).toBe(true);

      put("components/Action.tsx", "<Pressable />\n<Pressable />");
      const report = runCoverage(root);
      expect(report.ok).toBe(false);
      expect(report.increases).toEqual([
        { file: "app/src/components/Action.tsx", line: 2, previous: 1, current: 2 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checked-in baseline covers current source without raising its budgets", () => {
    const baseline = parseBaseline(readFileSync(join(ROOT, "scripts/a11y-coverage.baseline.json"), "utf8"));
    const report = checkRatchet(scanTree(ROOT), baseline);
    expect(report.ok).toBe(true);
    // A fixture regression must not be made acceptable by touching the checked-in baseline.
    expect(checkRatchet([finding(1, "app/src/components/NewScreen.tsx")], baseline).ok).toBe(false);
  });
});
