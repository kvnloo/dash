/**
 * In-app routes reachable by deep link:
 *   Expo Go:    exp://<metro>/--/lab   exp://<metro>/--/trace
 *   Dev build:  dash://lab             dash://trace
 * They open screens only and carry no parameters.
 */
export type AppRoute = "Lab" | "Trace";

const ROUTES: Record<string, AppRoute> = { lab: "Lab", trace: "Trace" };

export function parseAppRouteLink(raw: string | null | undefined): AppRoute | null {
  if (!raw) return null;
  const m = /^(?:dash|exp\+dash):\/\/([a-z]+)\/?(?:[?#].*)?$/i.exec(raw) ?? /\/--\/([a-z]+)\/?(?:[?#].*)?$/i.exec(raw);
  const key = m?.[1]?.toLowerCase();
  return key ? ROUTES[key] ?? null : null;
}

/** Same cold-start hold as createStageLinkRouter: open once navigation is ready. */
export function createAppRouteRouter(nav: { isReady(): boolean; open(route: AppRoute): void }) {
  let pending: AppRoute | null = null;
  return {
    handle(raw: string | null): boolean {
      const route = parseAppRouteLink(raw);
      if (!route) return false;
      if (nav.isReady()) nav.open(route);
      else pending = route;
      return true;
    },
    flush(): void {
      if (pending === null || !nav.isReady()) return;
      const route = pending;
      pending = null;
      nav.open(route);
    },
  };
}
