import { parseDashConnectUrl, type PairPrefill } from "./pair-url";
import { parseIdentityPairLink } from "../../../shared/z0bridge-identity";
export type EnrollmentPrefill = PairPrefill | { address: string; identityLink: string };
export function identityPrefill(raw: string): EnrollmentPrefill | null {
  if (!parseIdentityPairLink(raw)) return null;
  const address = new URLSearchParams(raw.slice(raw.indexOf("?") + 1)).get("bridge");
  if (!address || !/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(?:[0-9]{1,3})\.(?:[0-9]{1,3}):[0-9]{1,5}$/.test(address)) return null;
  const [host, port] = address.split(":");
  if (!host || !port || host.split(".").some(n => Number(n) > 255) || Number(port) < 1 || Number(port) > 65535) return null;
  return { address, identityLink: raw };
}

export type PairNavigator = {
  isReady(): boolean;
  openPair(prefill: EnrollmentPrefill): void;
};

/**
 * Routes pairing magic links to Pair. A link that arrives before navigation is
 * mounted (cold start behind fonts/hydration) is held, not dropped, and opened
 * once `flush()` runs from NavigationContainer's onReady. Only the newest link
 * is kept: an older code would be stale anyway.
 */
export function createDeepLinkRouter(nav: PairNavigator) {
  let pending: EnrollmentPrefill | null = null;
  return {
    handle(url: string | null | undefined): boolean {
      if (!url) return false;
      const prefill = identityPrefill(url) ?? parseDashConnectUrl(url);
      if (!prefill) return false;
      if (nav.isReady()) nav.openPair(prefill);
      else pending = prefill;
      return true;
    },
    flush(): void {
      if (!pending || !nav.isReady()) return;
      const prefill = pending;
      pending = null;
      nav.openPair(prefill);
    },
  };
}

/**
 * Pair keeps its own editable fields. When a link (re)opens an already mounted
 * Pair screen, its params change but `useState` initial values do not, so the
 * screen applies each distinct prefill once through this comparison.
 */
export function nextPrefill(params: Partial<PairPrefill> | undefined, applied: string | null): { prefill: PairPrefill; key: string } | null {
  const address = params?.address?.trim();
  const code = params?.code?.trim().toUpperCase();
  if (!address || !code) return null;
  const key = `${address}\n${code}`;
  return key === applied ? null : { prefill: { address, code }, key };
}
