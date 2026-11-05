import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { cancelAnimation, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from "react-native-reanimated";

import { ambient } from "../motion-ambient";

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
  useEffect(() => {
    if (active && !reduced) clock.value = withRepeat(withTiming(1, ambient(6000, true)), -1);
    else { cancelAnimation(clock); clock.value = 0; }
    return () => cancelAnimation(clock);
  }, [active, clock, reduced]);
  return <Clock.Provider value={clock}>{children}</Clock.Provider>;
}

export function OrbActivity({ active, children }: { active: boolean; children: ReactNode }) {
  return <Activity.Provider value={active}>{children}</Activity.Provider>;
}

export function useOrbMotion() {
  return { clock: useContext(Clock), active: useContext(Activity) };
}
