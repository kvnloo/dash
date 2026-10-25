import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { componentSizing, DENSITIES, tileColumns } from "./tile-layout";
import {
  getInformationDetailChoice,
  INFORMATION_DETAIL_CHOICES,
  projectStatInformation,
  resolveInformationDetail,
  setInformationDetailChoice,
  subscribeInformationDetail,
  type InformationDetailChoice,
} from "./information-density";

const segments = [
  { label: "resumed", n: 2 },
  { label: "not resumed", n: 3 },
];

describe("H-077 independent information detail", () => {
  test("Auto maps the existing layout presets to different evidence levels", () => {
    expect(DENSITIES.map(layout => resolveInformationDetail(layout, "auto"))).toEqual([
      "essential", "standard", "rich",
    ]);
    expect(INFORMATION_DETAIL_CHOICES).toEqual(["auto", "essential", "standard", "rich"]);
  });

  test("every explicit detail level works at every layout density, not just Rich geometry", () => {
    for (const layout of DENSITIES) {
      for (const detail of ["essential", "standard", "rich"] satisfies InformationDetailChoice[]) {
        expect(resolveInformationDetail(layout, detail)).toBe(detail);
      }
    }
    expect(resolveInformationDetail("compact", "rich")).toBe("rich");
    expect(resolveInformationDetail("rich", "essential")).toBe("essential");
  });

  test("changing information detail never mutates sizing or responsive column decisions", () => {
    for (const layout of DENSITIES) {
      const sizeBefore = componentSizing(layout, 1.6);
      const columnsBefore = tileColumns(360 - 32, layout, 1.6);
      for (const preference of INFORMATION_DETAIL_CHOICES) {
        expect(resolveInformationDetail(layout, preference)).toBeDefined();
        expect(componentSizing(layout, 1.6)).toEqual(sizeBefore);
        expect(tileColumns(360 - 32, layout, 1.6)).toBe(columnsBefore);
      }
    }
  });

  test("selection is shared, subscribed, idempotent, and cleaned up", () => {
    setInformationDetailChoice("auto");
    const seen: InformationDetailChoice[] = [];
    const unsubscribe = subscribeInformationDetail(() => seen.push(getInformationDetailChoice()));
    try {
      setInformationDetailChoice("rich");
      setInformationDetailChoice("rich");
      setInformationDetailChoice("standard");
      expect(seen).toEqual(["rich", "standard"]);
      expect(getInformationDetailChoice()).toBe("standard");
      unsubscribe();
      setInformationDetailChoice("essential");
      expect(seen).toEqual(["rich", "standard"]);
    } finally {
      unsubscribe();
      setInformationDetailChoice("auto");
    }
    expect(getInformationDetailChoice()).toBe("auto");
  });
});

describe("H-077 grounded stat information", () => {
  test("Essential leaves the existing scalar/visual content alone", () => {
    expect(projectStatInformation("essential", { value: 5, segments, series: [2, 4, 3] })).toEqual([]);
  });

  test("Standard adds source-backed counts and latest sample", () => {
    expect(projectStatInformation("standard", { value: 5, segments, series: [2, 4, 3] })).toEqual([
      { label: "Segments", value: "resumed 2 · not resumed 3" },
      { label: "Samples", value: "latest 3 · 3 samples" },
    ]);
  });

  test("Rich reveals more actual detail than Standard, with total provenance and range", () => {
    const input = { value: 5, segments, series: [2, 4, 3] };
    const standard = projectStatInformation("standard", input);
    const rich = projectStatInformation("rich", input);
    expect(rich).toEqual([
      { label: "Segments", value: "resumed 2 · not resumed 3 · sum 5 matches displayed 5" },
      { label: "Samples", value: "latest 3 · prior 4 · 3 samples" },
      { label: "Range", value: "min 2 · max 4" },
    ]);
    expect(rich.length).toBeGreaterThan(standard.length);
    expect(rich[0]?.value).toContain("resumed 2");
    expect(rich[1]?.value).toContain("prior 4");
  });

  test("mismatched totals are explicitly unreconciled, never presented as exact coverage", () => {
    expect(projectStatInformation("rich", { value: 8, segments })).toEqual([
      { label: "Segments", value: "resumed 2 · not resumed 3 · segment sum 5; displayed 8 (not reconciled)" },
    ]);
    expect(projectStatInformation("rich", { value: Number.NaN, segments })).toEqual([
      { label: "Segments", value: "resumed 2 · not resumed 3 · segment sum 5" },
    ]);
  });

  test("a subset value can use an explicit, source-grounded denominator", () => {
    expect(projectStatInformation("rich", { value: 2, segmentTotal: 5, segments })).toEqual([
      { label: "Segments", value: "resumed 2 · not resumed 3 · sum 5 matches reference total 5" },
    ]);
    expect(projectStatInformation("rich", { value: 2, segmentTotal: 7, segments })).toEqual([
      { label: "Segments", value: "resumed 2 · not resumed 3 · segment sum 5; reference total 7 (not reconciled)" },
    ]);
  });

  test("no added content is invented for a scalar lacking supporting evidence", () => {
    for (const level of ["essential", "standard", "rich"] satisfies InformationDetailChoice[]) {
      expect(projectStatInformation(level, { value: 12 })).toEqual([]);
      expect(projectStatInformation(level, { value: 12, segments: [], series: [] })).toEqual([]);
    }
  });

  test("malformed count segments are rejected together, not presented as partial totals", () => {
    for (const bad of [Number.NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(projectStatInformation("rich", { value: 3, segments: [{ label: "ok", n: 2 }, { label: "bad", n: bad }] })).toEqual([]);
    }
    expect(projectStatInformation("rich", { value: 2, segments: [{ label: "  ", n: 2 }] })).toEqual([]);
    expect(projectStatInformation("rich", {
      value: 2, segments: [{ label: "a", n: Number.MAX_SAFE_INTEGER }, { label: "b", n: 1 }],
    })).toEqual([]);
  });

  test("malformed series is omitted in full while valid independent segments remain", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(projectStatInformation("rich", { value: 5, segments, series: [2, bad, 3] })).toEqual([
        { label: "Segments", value: "resumed 2 · not resumed 3 · sum 5 matches displayed 5" },
      ]);
    }
  });

  test("single-sample, constant and negative series get literal observed values only", () => {
    expect(projectStatInformation("rich", { value: 5, series: [5] })).toEqual([
      { label: "Samples", value: "latest 5 · 1 sample" },
      { label: "Range", value: "min 5 · max 5" },
    ]);
    expect(projectStatInformation("rich", { value: 5, series: [4, 4, 4] })).toEqual([
      { label: "Samples", value: "latest 4 · prior 4 · 3 samples" },
      { label: "Range", value: "min 4 · max 4" },
    ]);
    expect(projectStatInformation("rich", { value: -3, series: [-10, -3, -6] })).toEqual([
      { label: "Samples", value: "latest -6 · prior -3 · 3 samples" },
      { label: "Range", value: "min -10 · max -3" },
    ]);
  });
});

describe("H-077 component wiring contract (source, not rendered/device evidence)", () => {
  const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");
  const picker = read("../components/InformationDensityPicker.tsx");
  const tile = read("../components/trace/StatTile.tsx");
  const trace = read("../screens/TraceScreen.tsx");
  const lab = read("../screens/LabScreen.tsx");

  test("both screens expose a separate information-detail choice alongside layout density", () => {
    for (const screen of [trace, lab]) {
      expect(screen).toContain("<DensityPicker />");
      expect(screen).toContain("<InformationDensityPicker />");
      expect(screen).toContain('from "../components/InformationDensityPicker"');
    }
  });

  test("StatTile consumes information detail and includes it in visible and accessible descriptions", () => {
    expect(tile).toContain("const { level } = useInformationDetail();");
    expect(tile).toContain("projectStatInformation(level, { value, segments: evidenceSegments ?? segments, segmentTotal: evidenceTotal, series })");
    expect(trace).toContain("evidenceTotal={st.workers}");
    expect(trace).toContain("Number.isSafeInteger(st.workers)");
    expect(trace).toContain('label: "not live"');
    expect(trace).toContain('label="cut" value={st.cut}');
    expect(trace).toContain('label: "not resumed"');
    expect(trace).toContain('label="active" value={series[series.length - 1] ?? 0}');
    expect(trace).toContain("variant=\"spark\" series={series}");
    expect(tile).toContain("summary={summary}");
    expect(tile).toContain("details.map(line => <Text key={line.label}");
    expect(tile).toContain("line.label + \": \" + line.value");
    expect(tile).toContain("minHeight: sizing.tileMin");
    expect(tile).toContain("flexShrink: 1");
  });

  test("detail controls preserve selected-state semantics, 44 DIP, scale and palette", () => {
    expect(picker).toContain("useSyncExternalStore(");
    expect(picker).toContain("INFORMATION_DETAIL_CHOICES.map(option =>");
    expect(picker).toContain("onPress={() => setInformationDetailChoice(option)}");
    expect(picker).toContain('accessibilityRole="button"');
    expect(picker).toContain("accessibilityState={{ selected: choice === option }}");
    expect(picker).toContain("minHeight: 44");
    expect(picker).toContain("minWidth: 44");
    expect(picker).toContain("allowFontScaling");
    expect(picker).toContain('flexWrap: "wrap"');
    expect(picker).toContain("colors.surfaceRaised");
    expect(picker).not.toContain("withTiming(");
    expect(picker).not.toContain("new Date(");
  });
});
