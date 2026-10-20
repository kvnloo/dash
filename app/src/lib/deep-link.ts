import { parseDashConnectUrl, type PairPrefill } from "./pair-url";

export type PairNavigator = {
  isReady(): boolean;
  openPair(prefill: PairPrefill): void;
};

/**
 * Routes pairing magic links to Pair. A link that arrives before navigation is
 * mounted (cold start behind fonts/hydration) is held, not dropped, and opened
 * once `flush()` runs from NavigationContainer's onReady. Only the newest link
 * is kept: an older code would be stale anyway.
 */
export function createDeepLinkRouter(nav: PairNavigator) {
  let pending: PairPrefill | null = null;
  return {
    handle(url: string | null | undefined): boolean {
      if (!url) return false;
      const prefill = parseDashConnectUrl(url);
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
