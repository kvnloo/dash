import type { RoadmapDocument, RoadmapItem, RoadmapStage } from "../vendor/ripple/native/roadmap";

type LedgerStatus = "implemented" | "partial" | "missing";

interface LedgerFeature {
  id: string;
  title: string;
  area: string;
  status: LedgerStatus;
  priority: string;
  recurring: boolean;
  journey: string;
  note: string;
  deviceReceipt: string;
}

export interface LedgerRoadmapOptions {
  priorities?: string[];
  recurringOnly?: boolean;
}

interface OrderedItem {
  priority: string;
  item: RoadmapItem;
}

const STAGE_ORDER: Record<RoadmapStage, number> = {
  planned: 0,
  partial: 1,
  candidate: 2,
  preview: 3,
  verified: 4,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLedgerStatus(value: unknown): value is LedgerStatus {
  return value === "implemented" || value === "partial" || value === "missing";
}

function parseFeature(value: unknown): LedgerFeature | null {
  if (!isRecord(value)
    || !isNonemptyString(value.id)
    || !isNonemptyString(value.title)
    || !isNonemptyString(value.area)
    || !isLedgerStatus(value.status_from_code)
    || !isNonemptyString(value.priority)
    || typeof value.recurring !== "boolean"
    || !isNonemptyString(value.journey)
    || (value.note !== undefined && typeof value.note !== "string")
    || (value.device_receipt !== undefined && typeof value.device_receipt !== "string")) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    area: value.area,
    status: value.status_from_code,
    priority: value.priority,
    recurring: value.recurring,
    journey: value.journey,
    note: typeof value.note === "string" ? value.note : "",
    deviceReceipt: typeof value.device_receipt === "string" ? value.device_receipt : "",
  };
}

function stageFor(feature: LedgerFeature): RoadmapStage {
  if (feature.status === "missing") return "planned";
  if (feature.status === "partial") return "partial";
  // A code-level "implemented" claim alone never proves device acceptance.
  return feature.deviceReceipt.trim() ? "verified" : "candidate";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priorityRank(priority: string): number | null {
  const match = /^P([0-9]+)$/.exec(priority);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isSafeInteger(rank) ? rank : null;
}

function comparePriority(a: string, b: string): number {
  const left = priorityRank(a);
  const right = priorityRank(b);
  if (left !== null && right !== null && left !== right) return left < right ? -1 : 1;
  if (left !== null && right === null) return -1;
  if (left === null && right !== null) return 1;
  return compareText(a, b);
}

function compareItems(a: OrderedItem, b: OrderedItem): number {
  return comparePriority(a.priority, b.priority)
    || STAGE_ORDER[a.item.stage] - STAGE_ORDER[b.item.stage]
    || compareText(a.item.id, b.item.id)
    // A duplicate ledger ID must not make input order a hidden sorting key.
    || compareText(a.item.title, b.item.title)
    || compareText(a.item.area, b.item.area)
    || compareText(a.item.detail, b.item.detail)
    || compareText(a.item.evidence, b.item.evidence);
}

/** Pure conversion of parsed ledger JSON. Invalid feature rows are counted, not rendered. */
export function ledgerToRoadmap(
  raw: unknown,
  options: LedgerRoadmapOptions = {},
): { doc: RoadmapDocument; skipped: number } {
  const source = isRecord(raw) ? raw : {};
  const baseline = typeof source.baseline === "string" ? source.baseline : "unknown";
  const generated = typeof source.generated === "string" ? source.generated : "unknown";
  const rows: unknown[] = Array.isArray(source.features) ? source.features : [];
  const ordered: OrderedItem[] = [];
  let skipped = 0;

  for (const row of rows) {
    const feature = parseFeature(row);
    if (feature === null) {
      skipped++;
      continue;
    }
    if (options.recurringOnly && !feature.recurring) continue;
    if (options.priorities && !options.priorities.includes(feature.priority)) continue;

    ordered.push({
      priority: feature.priority,
      item: {
        id: feature.id,
        title: feature.title,
        area: feature.area,
        stage: stageFor(feature),
        detail: Array.from(feature.note).slice(0, 140).join(""),
        evidence: feature.journey,
        next: "Prove on device: " + feature.journey,
      },
    });
  }

  ordered.sort(compareItems);
  return {
    doc: {
      id: "dash-roadmap",
      title: "Dash roadmap",
      updated: generated + " · ledger " + baseline,
      items: ordered.map(entry => entry.item),
    },
    skipped,
  };
}
