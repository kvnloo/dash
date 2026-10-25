import type { Density } from "./tile-layout";

/** Spatial density controls geometry. Information detail controls visible evidence. */
export type InformationDetail = "essential" | "standard" | "rich";
export type InformationDetailChoice = "auto" | InformationDetail;

export const INFORMATION_DETAIL_CHOICES: readonly InformationDetailChoice[] = [
  "auto", "essential", "standard", "rich",
];

let choice: InformationDetailChoice = "auto";
const listeners = new Set<() => void>();

export function getInformationDetailChoice(): InformationDetailChoice {
  return choice;
}

export function subscribeInformationDetail(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setInformationDetailChoice(next: InformationDetailChoice): void {
  if (choice === next || !INFORMATION_DETAIL_CHOICES.includes(next)) return;
  choice = next;
  for (const listener of listeners) listener();
}

/** Auto is the existing preset behaviour; an explicit choice overrides it without changing geometry. */
export function resolveInformationDetail(layout: Density, selected: InformationDetailChoice): InformationDetail {
  if (selected !== "auto") return selected;
  return layout === "rich" ? "rich" : layout === "compact" ? "essential" : "standard";
}

export type StatEvidenceSegment = { label: string; n: number };
export type StatInformationInput = {
  value: number;
  /** Optional source denominator for a breakdown of a subset rather than the tile value. */
  segmentTotal?: number;
  segments?: readonly StatEvidenceSegment[];
  series?: readonly number[];
};
export type StatInformationLine = { label: "Segments" | "Samples" | "Range"; value: string };

function validSegments(segments: readonly StatEvidenceSegment[] | undefined): StatEvidenceSegment[] {
  if (!segments?.length) return [];
  if (!segments.every(item => item.label.trim().length > 0 && Number.isSafeInteger(item.n) && item.n >= 0)) return [];
  const sum = segments.reduce((total, item) => total + item.n, 0);
  return Number.isSafeInteger(sum) ? [...segments] : [];
}

function validSeries(series: readonly number[] | undefined): readonly number[] {
  return series?.length && series.every(Number.isFinite) ? series : [];
}

/** Only observed, finite evidence may appear. No inferred units, timestamps or success claims. */
export function projectStatInformation(level: InformationDetail, input: StatInformationInput): StatInformationLine[] {
  if (level === "essential") return [];
  const result: StatInformationLine[] = [];
  const segments = validSegments(input.segments);
  if (segments.length) {
    const sum = segments.reduce((total, item) => total + item.n, 0);
    const pieces = segments.map(item => item.label.trim() + " " + item.n);
    let value = pieces.join(" · ");
    if (level === "rich") {
      const denominator = input.segmentTotal ?? input.value;
      const label = input.segmentTotal === undefined ? "displayed " : "reference total ";
      value += Number.isSafeInteger(denominator) && denominator >= 0
        ? sum === denominator
          ? " · sum " + sum + " matches " + label + denominator
          : " · segment sum " + sum + "; " + label + denominator + " (not reconciled)"
        : " · segment sum " + sum;
    }
    result.push({ label: "Segments", value });
  }

  const series = validSeries(input.series);
  if (series.length) {
    const latest = series[series.length - 1];
    let value = "latest " + latest;
    if (level === "rich" && series.length > 1) value += " · prior " + series[series.length - 2];
    value += " · " + series.length + (series.length === 1 ? " sample" : " samples");
    result.push({ label: "Samples", value });
    if (level === "rich") {
      let min = Infinity;
      let max = -Infinity;
      for (const observed of series) { min = Math.min(min, observed); max = Math.max(max, observed); }
      result.push({ label: "Range", value: "min " + min + " · max " + max });
    }
  }
  return result;
}
