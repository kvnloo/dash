/**
 * Slice 1: useZ0LiveOrbService — wires z0live events to the native VoiceOrbService.
 *
 * Mount once in App.tsx or ContinuousVoiceRoot.tsx.
 * - On z0live_start SSE → DashVoiceOrb.startOrb(phase, muted)
 * - On z0live_phase SSE → DashVoiceOrb.updateOrb(phase, muted)
 * - On z0live_end SSE   → DashVoiceOrb.stopOrb()
 * - On AppState changes → DashVoiceOrb.setAppForegrounded(boolean)
 *
 * Also keeps the existing 1 Hz poll as source-of-truth state for in-app rendering;
 * the SSE only drives the native orb service faster.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useZ0LiveEvents } from "./z0live-events";
import { DashVoiceOrb } from "../../modules/dash-voice-orb/src/index";
import type { Settings } from "../model";
import type { Z0LiveState } from "../../../shared/z0live-state";

export function useZ0LiveOrbService(
  settings: Settings | null,
  z0liveState: Z0LiveState | undefined
) {
  const orbRunning = useRef(false);
  const lastPhase  = useRef<string>("connecting");
  const lastMuted  = useRef<boolean>(false);

  // Sync the in-app z0live poll state → native service (backup path if SSE missed)
  useEffect(() => {
    if (!z0liveState) return;
    if (z0liveState.live) {
      const phase = z0liveState.phase;
      const muted = z0liveState.muted ?? false;
      if (!orbRunning.current) {
        orbRunning.current = true;
        void DashVoiceOrb.startOrb(phase, muted);
      } else if (phase !== lastPhase.current || muted !== lastMuted.current) {
        void DashVoiceOrb.updateOrb(phase, muted);
      }
      lastPhase.current = phase;
      lastMuted.current = muted;
    } else if (orbRunning.current) {
      orbRunning.current = false;
      void DashVoiceOrb.stopOrb();
    }
  }, [z0liveState]);

  // SSE faster path
  useZ0LiveEvents(settings, true, (event) => {
    switch (event.name) {
      case "z0live_start": {
        const phase = event.data.phase ?? "connecting";
        const muted = event.data.muted ?? false;
        orbRunning.current = true;
        lastPhase.current = phase;
        lastMuted.current = muted;
        void DashVoiceOrb.startOrb(phase, muted);
        break;
      }
      case "z0live_phase": {
        const phase = event.data.phase ?? lastPhase.current;
        const muted = event.data.muted ?? lastMuted.current;
        lastPhase.current = phase;
        lastMuted.current = muted;
        void DashVoiceOrb.updateOrb(phase, muted);
        break;
      }
      case "z0live_end": {
        orbRunning.current = false;
        void DashVoiceOrb.stopOrb();
        break;
      }
    }
  });

  // Foreground/background handoff
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      void DashVoiceOrb.setAppForegrounded(state === "active");
    });
    // Set initial state
    void DashVoiceOrb.setAppForegrounded(AppState.currentState === "active");
    return () => sub.remove();
  }, []);
}
