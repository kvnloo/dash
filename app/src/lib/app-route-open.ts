import { debugNavigationRef } from "../debug/nav";
import type { AppRoute } from "./app-route-link";

/** Open an app route (deep link, preview hand-off or the Now testing card) on the root navigator. */
export function openAppRoute(route: AppRoute): void {
  if (route === "Dogfood") debugNavigationRef.navigate("Main", { home: true });
  else if (route === "Orchestra") debugNavigationRef.navigate("Main", { tab: 2 });
  else if (route === "Bots" || route === "Hosts") debugNavigationRef.navigate("Main", { tab: 0 });
  else if (route === "Chats") debugNavigationRef.navigate("Main", { tab: 1 });
  else debugNavigationRef.navigate(route);
}
