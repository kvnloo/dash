import { describe, expect, test } from "bun:test";
import { roadmapCounts, STAGES } from "../vendor/ripple/native/roadmap";
import { ledgerToRoadmap } from "./ledger-roadmap";

type Status = "implemented" | "partial" | "missing";

function feature(
  id: string,
  status: Status,
  priority = "P0",
  recurring = true,
) {
  return {
    id,
    title: "Feature " + id,
    area: "generated-ui",
    status_from_code: status,
    priority,
    recurring,
    journey: "J-roadmap-inline",
  };
}

function ledger(features: unknown[]) {
  return {
    baseline: "cfc08de",
    generated: "2026-10-25",
    features,
  };
}

describe("ledgerToRoadmap", () => {
  test("maps all three code statuses and only device-receipted implementations to verified", () => {
    const raw = ledger([
      feature("DF-003", "implemented"),
      feature("DF-001", "missing"),
      { ...feature("DF-004", "implemented"), device_receipt: "device:sha:abc123" },
      feature("DF-002", "partial"),
    ]);
    const { doc, skipped } = ledgerToRoadmap(raw);

    expect(skipped).toBe(0);
    expect(doc.id).toBe("dash-roadmap");
    expect(doc.title).toBe("Dash roadmap");
    expect(doc.updated).toBe("2026-10-25 · ledger cfc08de");
    expect(doc.items.map(item => [item.id, item.stage])).toEqual([
      ["DF-001", "planned"],
      ["DF-002", "partial"],
      ["DF-003", "candidate"],
      ["DF-004", "verified"],
    ]);
    expect(roadmapCounts(doc.items)).toEqual({
      total: 4,
      preview: 1,
      verified: 1,
      remaining: 3,
    });
    expect(doc.items[0]).toEqual({
      id: "DF-001",
      title: "Feature DF-001",
      stage: "planned",
      area: "generated-ui",
      detail: "",
      evidence: "J-roadmap-inline",
      next: "Prove on device: J-roadmap-inline",
    });
    for (const item of doc.items) expect(Object.keys(STAGES)).toContain(item.stage);
  });

  test("empty receipts cannot promote code claims; partial and missing stay below verified", () => {
    const { doc, skipped } = ledgerToRoadmap(ledger([
      { ...feature("DF-001", "implemented"), device_receipt: "" },
      { ...feature("DF-002", "implemented"), device_receipt: "   " },
      { ...feature("DF-003", "partial"), device_receipt: "device:receipt" },
      { ...feature("DF-004", "missing"), device_receipt: "device:receipt" },
    ]));
    expect(skipped).toBe(0);
    expect(doc.items.map(item => [item.id, item.stage])).toEqual([
      ["DF-004", "planned"],
      ["DF-003", "partial"],
      ["DF-001", "candidate"],
      ["DF-002", "candidate"],
    ]);
    expect(doc.items.every(item => item.stage !== "verified")).toBe(true);
  });

  test("recurringOnly and exact priority filters work separately and together", () => {
    const raw = ledger([
      feature("DF-001", "implemented", "P0", true),
      feature("DF-002", "partial", "P1", true),
      feature("DF-003", "missing", "P0", false),
      feature("DF-004", "implemented", "P2", false),
    ]);
    const ids = (options: { priorities?: string[]; recurringOnly?: boolean }) =>
      ledgerToRoadmap(raw, options).doc.items.map(item => item.id);

    expect(ids({ recurringOnly: true })).toEqual(["DF-001", "DF-002"]);
    expect(ids({ priorities: ["P0"] })).toEqual(["DF-003", "DF-001"]);
    expect(ids({ priorities: ["P0", "P2"], recurringOnly: true })).toEqual(["DF-001"]);
    expect(ids({ priorities: [] })).toEqual([]);
    expect(ids({ priorities: ["p0"] })).toEqual([]);
    expect(ids({})).toHaveLength(4);
  });

  test("sorts priority numerically, then stage, then ID independent of source order", () => {
    const features = [
      feature("DF-009", "implemented", "P1"),
      feature("DF-003", "partial", "P0"),
      feature("DF-002", "missing", "P0"),
      { ...feature("DF-008", "implemented", "P0"), device_receipt: "phone:run-7" },
      feature("DF-004", "implemented", "P0"),
      feature("DF-001", "missing", "P0"),
      feature("DF-010", "missing", "P10"),
      feature("DF-011", "missing", "P2"),
    ];
    const expectedIds = [
      "DF-001", "DF-002", "DF-003", "DF-004", "DF-008", "DF-009", "DF-011", "DF-010",
    ];
    const initial = ledgerToRoadmap(ledger(features));
    expect(initial.doc.items.map(item => item.id)).toEqual(expectedIds);
    for (const shuffled of [
      [...features].reverse(),
      [features[4], features[1], features[7], features[2], features[5], features[0], features[6], features[3]],
      [...features].sort((a, b) => b.id.localeCompare(a.id)),
    ]) {
      expect(ledgerToRoadmap(ledger(shuffled))).toEqual(initial);
    }
  });

  test("rejects malformed rows, counts them even when filtered, and does not crash on bad roots", () => {
    const source = ledger([
      feature("DF-001", "implemented"),
      null,
      {},
      { ...feature("DF-002", "missing"), status_from_code: "done" },
      { ...feature("DF-003", "partial"), priority: 0 },
      { ...feature("DF-004", "missing"), recurring: "yes" },
      { ...feature("DF-005", "implemented"), note: 99 },
      { ...feature("DF-006", "implemented"), device_receipt: false },
      { ...feature("DF-007", "missing"), title: " " },
    ]);
    const output = ledgerToRoadmap(source, { priorities: ["P9"] });
    expect(output.skipped).toBe(8);
    expect(output.doc.items).toEqual([]);
    expect(ledgerToRoadmap(source).skipped).toBe(8);
    expect(ledgerToRoadmap(source).doc.items.map(item => item.id)).toEqual(["DF-001"]);

    for (const malformed of [null, [], false, "not a ledger", { features: {} }]) {
      expect(ledgerToRoadmap(malformed)).toEqual({
        doc: {
          id: "dash-roadmap",
          title: "Dash roadmap",
          updated: "unknown · ledger unknown",
          items: [],
        },
        skipped: 0,
      });
    }
  });

  test("clamps note to 140 Unicode characters and preserves input without mutation", () => {
    const note = "🌿".repeat(141) + "extra";
    const source = ledger([
      { ...feature("DF-055", "partial"), note, extra_field: { untrusted: "ignored" } },
    ]);
    const before = JSON.stringify(source);
    const result = ledgerToRoadmap(source);
    expect(result.skipped).toBe(0);
    expect(Array.from(result.doc.items[0].detail)).toHaveLength(140);
    expect(result.doc.items[0].detail).toBe("🌿".repeat(140));
    expect(result.doc.items[0].evidence).toBe("J-roadmap-inline");
    expect(result.doc.items[0].next).toBe("Prove on device: J-roadmap-inline");
    expect(JSON.stringify(source)).toBe(before);
    expect(ledgerToRoadmap(source)).toEqual(result);
  });

  test("duplicate IDs have deterministic tie-breaking without losing ledger entries", () => {
    const one = { ...feature("DF-055", "partial"), title: "First" };
    const two = { ...feature("DF-055", "partial"), title: "Second" };
    const expected = ledgerToRoadmap(ledger([one, two]));
    expect(expected.doc.items.map(item => item.title)).toEqual(["First", "Second"]);
    expect(ledgerToRoadmap(ledger([two, one]))).toEqual(expected);
  });
});
