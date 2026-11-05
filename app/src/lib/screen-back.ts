import { toMain, type MainReturn } from "./main-nav";

/** A screen's Back returns to its caller; tab buttons deliberately use toMain instead. */
export function screenBack(navigation: MainReturn & { canGoBack(): boolean; goBack(): void }): void {
  if (navigation.canGoBack()) navigation.goBack();
  else toMain(navigation);
}
