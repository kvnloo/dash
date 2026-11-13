import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from "react-native-reanimated";
import { turboMs } from "../turbo";

const CYCLE_MS = turboMs(6000);

const Clock = createContext<SharedValue<number> | null>(null);
const Activity = createContext(true);

/** One compositor clock for the app, stopped in the background or for reduced motion. */
export function OrbMotionProvider({ children }: { children: ReactNode }) {
  const clock = useSharedValue(0);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    // Unwrapped cycles; the first resumed frame excludes suspended time.
    clock.value += (timeSincePreviousFrame ?? 0) / CYCLE_MS;
  }, false);
  useEffect(() => {
    frame.setActive(active && !reduced);
    return () => frame.setActive(false);
  }, [active, reduced, frame]);
  return <Clock.Provider value={clock}><Activity.Provider value={active}>{children}</Activity.Provider></Clock.Provider>;
}

export function OrbActivity({ active, children }: { active: boolean; children: ReactNode }) {
  return <Activity.Provider value={active}>{children}</Activity.Provider>;
}

export function useOrbMotion() {
  return { clock: useContext(Clock), active: useContext(Activity) };
}
