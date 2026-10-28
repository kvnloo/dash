import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Linking, NativeModules, Platform } from "react-native";
import {
  POLL_MS,
  RUNNING_BUILD,
  decideReload,
  developmentClientLink,
  endpointOrigin,
  fetchServedBuild,
  metroOrigin,
  reloadBlockedBy,
  scriptUrlOrigin,
  type LiveBuild,
  type MetroEndpoint,
  type ReloadDecision,
} from "./live-update";
import { idleMs } from "./touch-idle";
import { reloadApp } from "./reload-app";

const AUTO_KEY = "dash.liveUpdate.auto";
const TRIED_KEY = "dash.liveUpdate.autoFor";

// Web-only URL seams mirror store/annotate.ts. Native keeps immutable build-info.json.
const webParams = Platform.OS === "web" && typeof location !== "undefined" ? new URLSearchParams(location.search) : null;

function runningBuild(): LiveBuild | null {
  const sha = webParams?.get("liveRunning");
  if (sha !== null && sha !== undefined && /^[0-9a-f]{40}$/i.test(sha)) {
    return { sha: sha.toLowerCase(), builtAtMs: RUNNING_BUILD?.builtAtMs ?? null };
  }
  return RUNNING_BUILD;
}

function webIdleReloadMs(): number | undefined {
  const value = webParams?.get("liveIdleMs");
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function keyboardVisible(): boolean {
  if (Platform.OS !== "web") return Keyboard.isVisible();
  if (typeof document === "undefined") return false;
  const focused = document.activeElement;
  return focused !== null && focused.matches('input, textarea, [contenteditable="true"], [role="textbox"]');
}

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

/** Where this bundle was fetched from: the origin a reload will fetch from again. */
function bundleOrigin(): string | null {
  const source: unknown = NativeModules.SourceCode;
  if (typeof source !== "object" || source === null) return null;
  if ("scriptURL" in source) return scriptUrlOrigin(source.scriptURL);
  if ("getConstants" in source && typeof source.getConstants === "function") {
    const constants: unknown = source.getConstants();
    if (typeof constants === "object" && constants !== null && "scriptURL" in constants) return scriptUrlOrigin(constants.scriptURL);
  }
  return null;
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
  const running = runningBuild();
  const requestedOrigin = webParams?.get("liveOrigin");
  const origin = requestedOrigin !== null && requestedOrigin !== undefined
    ? metroOrigin(requestedOrigin)
    : running === null ? null : bundleOrigin() ?? metroOrigin(Constants.expoConfig?.hostUri);
  const [served, setServed] = useState<LiveBuild | null>(null);
  const [autoReload, setAutoState] = useState(true);
  const [lastAutoFor, setLastAutoFor] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const foregroundAt = useRef<number | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    void readPref(AUTO_KEY).then((value) => setAutoState(value !== "0"));
    void readPref(TRIED_KEY).then((value) => setLastAutoFor((current) => current ?? value));
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
    const tick = setInterval(() => setTick((n) => n + 1), Platform.OS === "web" ? 250 : 5_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (Platform.OS !== "web") foregroundAt.current = Date.now();
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
    if (served !== null && running !== null && served.sha === running.sha && lastAutoFor !== null) {
      setLastAutoFor(null);
      void writePref(TRIED_KEY, null);
    }
  }, [served, lastAutoFor]);

  const decision = decideReload({
    running,
    served,
    autoReload,
    sinceForegroundMs: foregroundAt.current === null ? Number.POSITIVE_INFINITY : Date.now() - foregroundAt.current,
    idleMs: idleMs(),
    idleReloadMs: webIdleReloadMs(),
    keyboardVisible: keyboardVisible(),
    blockedBy: reloadBlockedBy(),
    lastAutoFor,
  });

  const reloadNow = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    reloadApp();
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

  return { running, served, origin, decision, autoReload, setAutoReload, reloadNow, switchTo };
}
