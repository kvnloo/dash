/**
 * Now testing (ledger DA-004, dash#107): right after a turbo promotion the phone says which feature
 * this build asks you to test and takes you to its screen.
 *
 * scripts/turbo/now_testing.py (called by turbo-promote) writes `testing` next to {sha, builtAtMs} in
 * src/lib/build-info.json; the bundle bakes it in, so the card and the running build cannot disagree.
 */
import buildInfoJson from "./build-info.json";
import { parseAppRouteLink, type AppRoute } from "./app-route-link";

export interface NowTesting {
  /** The promoted commit this card belongs to. */
  sha: string;
  feature: string;
  /** dash://<route> to open, already validated against app-route-link. */
  link: string | null;
  route: AppRoute | null;
  steps: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

export function parseNowTesting(value: unknown): NowTesting | null {
  if (!isRecord(value) || !isRecord(value.testing)) return null;
  const sha = typeof value.sha === "string" ? value.sha.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{7,64}$/.test(sha)) return null;
  const feature = text(value.testing.feature, 120);
  if (!feature) return null;
  const raw = typeof value.testing.screen === "string" ? value.testing.screen.trim() : "";
  const route = /^dash:\/\/[a-z]+\/?$/i.test(raw) ? parseAppRouteLink(raw) : null;
  return { sha, feature, link: route ? raw : null, route, steps: text(value.testing.steps, 200) };
}

/** What this bundle asks the owner to test. Null in a local checkout, a release or a plain promote. */
export const NOW_TESTING: NowTesting | null = parseNowTesting(buildInfoJson);

/** Storage key: the card shows once per promoted commit, until opened or dismissed. */
export const NOW_TESTING_SEEN_KEY = "dash.nowTesting.seen";
