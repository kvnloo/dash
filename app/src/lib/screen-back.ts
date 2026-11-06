import { StackActions } from "@react-navigation/routers";
import { toMain, type MainReturn } from "./main-nav";

/** A screen's Back returns to its caller; tab buttons deliberately use toMain instead. */
export function screenBack(navigation: MainReturn & { canGoBack(): boolean; goBack(): void }): void {
  if (navigation.canGoBack()) navigation.goBack();
  else toMain(navigation);
}

/** Pop a particular route, not whichever screen is focused when a closing animation settles. */
export function ownRoutePopAction(
  state: { key: string; routes: ReadonlyArray<{ key: string }> },
  routeKey: string,
) {
  if (!state.routes.some(route => route.key === routeKey)) return null;
  return { ...StackActions.pop(1), source: routeKey, target: state.key };
}
