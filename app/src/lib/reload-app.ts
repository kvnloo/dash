import { DevSettings } from "react-native";

/** Native dev-client reload; the web army uses reload-app.web.ts. */
export function reloadApp(): void {
  DevSettings.reload();
}
