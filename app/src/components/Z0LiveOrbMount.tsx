/**
 * Z0LiveOrbMount — a null-rendering component that wires the z0live orb service.
 * Mount inside the NavigationContainer tree (after settings are hydrated).
 * Does nothing on web/Expo Go.
 */
import { Platform } from "react-native";
import { store } from "../store/app";
import { useZ0LiveState } from "../lib/z0live-state";
import { useZ0LiveOrbService } from "../lib/voice-orb-service";

export function Z0LiveOrbMount() {
  const settings = store.use((s) => s.settings);
  // Re-use the poll as the state source; SSE push happens inside useZ0LiveOrbService.
  const z0liveState = useZ0LiveState(settings, Platform.OS === "android");
  useZ0LiveOrbService(settings, z0liveState);
  return null;
}
