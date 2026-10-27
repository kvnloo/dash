import { parseStageDeepLink } from "./stage-link";

/** Hold cold-start Expo Go links until fonts, hydration and navigation are ready. */
export function createStageLinkRouter(nav: { isReady(): boolean; openStage(url: string): void }) {
  let pending: string | null = null;
  return {
    handle(raw: string | null): boolean {
      const url = raw ? parseStageDeepLink(raw) : null;
      if (!url) return false;
      if (nav.isReady()) nav.openStage(url);
      else pending = url;
      return true;
    },
    flush(): void {
      if (pending === null || !nav.isReady()) return;
      const url = pending;
      pending = null;
      nav.openStage(url);
    },
  };
}
