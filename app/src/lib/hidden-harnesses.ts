import type { HarnessInfo } from "../../../shared/protocol";

/**
 * Harness ids a build hides from every picker (release candidates hide harnesses
 * without a verified rule). Baked in at bundle time: EXPO_PUBLIC_DASH_HIDE_HARNESSES=grok,pi
 */
export function hiddenHarnessIds(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map(id => id.trim().toLowerCase()).filter(Boolean));
}

export function visibleHarnesses(harnesses: HarnessInfo[], hidden: Set<string> = hiddenHarnessIds(process.env.EXPO_PUBLIC_DASH_HIDE_HARNESSES)): HarnessInfo[] {
  return hidden.size === 0 ? harnesses : harnesses.filter(h => !hidden.has(h.id.toLowerCase()));
}
