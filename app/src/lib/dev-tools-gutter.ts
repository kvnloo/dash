import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { devToolsGutter } from "./dev-tools-inset";

function read(): number {
  // Read at module load, like ?annotateEngine: navigation rewrites the web URL after start-up.
  const forced = Platform.OS === "web" && typeof location !== "undefined" && new URLSearchParams(location.search).get("devToolsGutter") === "1";
  let devMenu = false;
  try {
    devMenu = Platform.OS !== "web" && requireOptionalNativeModule("ExpoDevMenu") !== null;
  } catch {
    devMenu = false;
  }
  return devToolsGutter({ dev: __DEV__, os: Platform.OS, devMenu, forced });
}
const GUTTER = read();

/** Right-edge space floating overlays leave for the dev-client Tools gear; 0 in release builds. */
export function devToolsGutterNow(): number { return GUTTER; }
