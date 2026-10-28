import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, DevSettings, Keyboard, Linking, NativeModules, Platform } from "react-native";
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
import { installReloadGuards } from "./reload-guards";
import { flushDrafts } from "../store/composer-drafts";

const AUTO_KEY = "dash.liveUpdate.auto";
const TRIED_KEY = "dash.liveUpdate.autoFor";

/** Native dev clients reload through Expo; the web army reloads the served page. */
function reloadApp(): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.location.reload();
    return;
  }
  DevSettings.reload();
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
  blockedBy: string | null;
  switchTo(endpoint: MetroEndpoint): void;
}

/**
 * Polls the Metro this bundle came from. When it serves a different build, reloads the app
 * (when the owner returns to it, or after 30 s without a touch), unless a guard says busy.
 */
export function useLiveUpdate(): LiveUpdate {
  const origin = RUNNING_BUILD === null ? null : bundleOrigin() ?? metroOrigin(Constants.expoConfig?.hostUri);
  const [served, setServed] = useState<LiveBuild | null>(null);
  const [autoReload, setAutoState] = useState(true);
  const [lastAutoFor, setLastAutoFor] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [, setTick] = useState(0);
  const foregroundAt = useRef(Date.now());
  const heldFor = useRef<string | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([readPref(AUTO_KEY), readPref(TRIED_KEY)]).then(([auto, attempted]) => {
      if (!alive) return;
      setAutoState(auto !== "0");
      setLastAutoFor(attempted);
      setPrefsReady(true);
    });
    return () => { alive = false; };
  }, []);

  // Register once for the mounted poller, and re-evaluate immediately when active work changes.
  useEffect(() => installReloadGuards(() => setTick(n => n + 1)), []);

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

  const blockedBy = reloadBlockedBy();
  const decision = decideReload({
    running: RUNNING_BUILD,
    served,
    autoReload: autoReload && prefsReady,
    sinceForegroundMs: Date.now() - foregroundAt.current,
    idleMs: idleMs(),
    keyboardVisible: Keyboard.isVisible(),
    blockedBy,
    heldFor: heldFor.current,
    lastAutoFor,
  });
  const blocked = decision.kind === "ready" && decision.why === "blocked";
  useEffect(() => {
    if (blocked && served !== null && autoReload) heldFor.current = served.sha;
  }, [blocked, served?.sha, autoReload]);

  const requestReload = useCallback((automatic: boolean) => {
    if (reloading.current || (automatic && reloadBlockedBy() !== null)) return;
    reloading.current = true;
    void (async () => {
      let invoked = false;
      try {
        // The 250ms draft debounce is too late if Metro reloads immediately.
        await flushDrafts();
        // A voice call or stream may have begun during the asynchronous storage write.
        if (automatic && reloadBlockedBy() !== null) return;
        if (automatic && served !== null) {
          await writePref(TRIED_KEY, served.sha);
          setLastAutoFor(served.sha);
        }
        invoked = true;
        reloadApp();
      } catch (error) {
        console.warn("[live-update] reload cancelled: drafts could not be persisted", error);
      } finally {
        if (invoked) setTimeout(() => { reloading.current = false; }, 10_000);
        else {
          reloading.current = false;
          setTick(n => n + 1);
        }
      }
    })();
  }, [served]);
  const reloadNow = useCallback(() => requestReload(false), [requestReload]);

  useEffect(() => {
    if (decision.kind === "reload" && served !== null && !reloading.current) requestReload(true);
  }, [decision.kind, served?.sha, requestReload]);

  const setAutoReload = useCallback((on: boolean) => {
    setAutoState(on);
    if (!on) heldFor.current = null;
    void writePref(AUTO_KEY, on ? null : "0");
  }, []);

  const switchTo = useCallback(
    (endpoint: MetroEndpoint) => {
      const target = origin === null ? null : endpointOrigin(origin, endpoint.port);
      if (target !== null) void Linking.openURL(developmentClientLink(appScheme(), target));
    },
    [origin],
  );

  return { running: RUNNING_BUILD, served, origin, decision, autoReload, setAutoReload, reloadNow, blockedBy, switchTo };
}
