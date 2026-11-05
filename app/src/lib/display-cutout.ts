import type { CutoutReading } from "./chat-window";

/** Web, iOS and Expo Go: no DisplayCutout provider. The pill uses its safe-area fallback. */
export function readCutout(): CutoutReading | null {
  return null;
}
