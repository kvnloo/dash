import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, DevSettings, Keyboard, Linking } from "react-native";
import {
  POLL_MS,
  RUNNING_BUILD,
  decideReload,
  developmentClientLink,
  endpointOrigin,
  fetchServedBuild,
  metroOrigin,
  reloadBlockedBy,
  type LiveBuild,
  type MetroEndpoint,
  type ReloadDecision,
} from "./live-update";
import { idleMs } from "./touch-idle";

const AUTO_KEY = "dash.liveUpdate.auto";
const TRIED_KEY = "dash.liveUpdate.autoFor";

async function readPref(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writePref(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; the reload decision stays safe without them.
  }
}

function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  if (typeof scheme === "string" && scheme !== "") return scheme;
  if (Array.isArray(scheme) && typeof scheme[0] === "string") return scheme[0];
  return "dash";
}

export interface LiveUpdate {
  running: LiveBuild | null;
  served: LiveBuild | null;
  origin: string | null;
  decision: ReloadDecision;
  autoReload: boolean;
  setAutoReload(on: boolean): void;
  reloadNow(): void;
  switchTo(endpoint: MetroEndpoint): void;
}

/**
 * Polls the Metro this bundle came from. When it serves a different build, reloads the app
 * (when the owner returns to it, or after 30 s without a touch), unless a guard says busy.
 */
export function useLiveUpdate(): LiveUpdate {
  const origin = RUNNING_BUILD === null ? null : metroOrigin(Constants.expoConfig?.hostUri);
  const [served, setServed] = useState<LiveBuild | null>(null);
  const [autoReload, setAutoState] = useState(true);
  const [lastAutoFor, setLastAutoFor] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const foregroundAt = useRef(Date.now());
  const reloading = useRef(false);

  useEffect(() => {
    void readPref(AUTO_KEY).then((value) => setAutoState(value !== "0"));
    void readPref(TRIED_KEY).then(setLastAutoFor);
  }, []);

  useEffect(() => {
    if (origin === null) return;
    let alive = true;
    const poll = () => {
      if (AppState.currentState !== "active") return;
      void fetchServedBuild(origin, fetch).then((build) => {
        if (alive && build !== null) setServed(build);
      });
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    // Re-evaluate the idle gate between polls while an update waits.
    const tick = setInterval(() => setTick((n) => n + 1), 5_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      foregroundAt.current = Date.now();
      poll();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(tick);
      sub.remove();
    };
  }, [origin]);

  // A reload that landed on the served build clears the retry guard.
  useEffect(() => {
    if (served !== null && RUNNING_BUILD !== null && served.sha === RUNNING_BUILD.sha && lastAutoFor !== null) {
      setLastAutoFor(null);
      void writePref(TRIED_KEY, null);
    }
  }, [served, lastAutoFor]);

  const decision = decideReload({
    running: RUNNING_BUILD,
    served,
    autoReload,
    sinceForegroundMs: Date.now() - foregroundAt.current,
    idleMs: idleMs(),
    keyboardVisible: Keyboard.isVisible(),
    blockedBy: reloadBlockedBy(),
    lastAutoFor,
  });

  const reloadNow = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    DevSettings.reload();
    setTimeout(() => {
      reloading.current = false;
    }, 10_000);
  }, []);

  useEffect(() => {
    if (decision.kind !== "reload" || served === null || reloading.current) return;
    setLastAutoFor(served.sha);
    void writePref(TRIED_KEY, served.sha).then(reloadNow);
  }, [decision.kind, served, reloadNow]);

  const setAutoReload = useCallback((on: boolean) => {
    setAutoState(on);
    void writePref(AUTO_KEY, on ? null : "0");
  }, []);

  const switchTo = useCallback(
    (endpoint: MetroEndpoint) => {
      const target = origin === null ? null : endpointOrigin(origin, endpoint.port);
      if (target !== null) void Linking.openURL(developmentClientLink(appScheme(), target));
    },
    [origin],
  );

  return { running: RUNNING_BUILD, served, origin, decision, autoReload, setAutoReload, reloadNow, switchTo };
}
