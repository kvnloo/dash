/** Arms the native over-any-app z0live orb for the paired bridge. Renders nothing; no-op off Android. */
import { useEffect } from "react";
import { store } from "../store/app";
import { armVoiceOrb, voiceOrbAvailable } from "../lib/overlay-orb";

export function Z0LiveOrbMount() {
  const settings = store.use((s) => s.settings);
  useEffect(() => {
    if (!voiceOrbAvailable || !settings?.address) return;
    return armVoiceOrb(settings);
  }, [settings]);
  return null;
}
