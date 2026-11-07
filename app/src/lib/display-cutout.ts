import { debugUi } from "../debug/ui-store";
import { parseCutout, type CutoutReading } from "./chat-window";

/** Web, iOS and Expo Go: no DisplayCutout provider. The pill uses its safe-area fallback. */
export function readCutout(): CutoutReading | null {
  return null;
}

/**
 * Web only: the tester army cannot attach a camera, so it feeds the one hardware input (the
 * DisplayCutout reading) through this hook, like window.__dashDex does for DeX. It replaces nothing
 * but that reading; pairing, chats and the bridge stay real. `null` removes it.
 */
function simulateCutout(reading: unknown): void {
  debugUi.set(s => ({ ...s, cutoutFixture: reading === null ? null : parseCutout(reading) }));
}
declare global { interface Window { __dashCutout?: { simulate: typeof simulateCutout } } }
if (typeof window !== "undefined") window.__dashCutout = { simulate: simulateCutout };
