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
  probeLaunchAsset,
  reloadBlockedBy,
  scriptUrlOrigin,
  type BundleHealth,
  type LiveBuild,
  type MetroEndpoint,
  type ReloadDecision,
  type ReloadInput,
  type ServedManifest,
} from "./live-update";
import { idleMs } from "./touch-idle";
import { reloadApp } from "./reload-app";
import { installReloadGuards } from "./reload-guards";
import { flushDrafts } from "../store/composer-drafts";

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

/** The army serves a real manifest endpoint; keep polling faster for short active turns. */
function webPollMs(): number | undefined {
  const value = webParams?.get("livePollMs");
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 100 ? milliseconds : undefined;
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
  blockedBy: string | null;
  switchTo(endpoint: MetroEndpoint): void;
}

/**
 * Polls the Metro this bundle came from. When it serves a different build, reloads the app
 * (when the owner returns to it, or after 30 s without a touch), unless a guard says busy.
 */
export function useLiveUpdate(): LiveUpdate {
  const running = runningBuild();
  const runningSha = running?.sha ?? null;
  const requestedOrigin = webParams?.get("liveOrigin");
  const origin = requestedOrigin !== null && requestedOrigin !== undefined
    ? metroOrigin(requestedOrigin)
    : running === null ? null : bundleOrigin() ?? metroOrigin(Constants.expoConfig?.hostUri);
  const [served, setServed] = useState<LiveBuild | null>(null);
  const [bundleHealth, setBundleHealth] = useState<BundleHealth | null>(null);
  // Polling reuses successful probes; each newer-build reload revalidates its launch asset.
  const healthyAssets = useRef(new Map<string, string | null>());
  const latestManifest = useRef<(ServedManifest & { key: string; origin: string }) | null>(null);
  const verifiedKey = useRef<string | null>(null);
  const [autoReload, setAutoState] = useState(true);
  const [lastAutoFor, setLastAutoFor] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [, setTick] = useState(0);
  const foregroundAt = useRef<number | null>(null);
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

  useEffect(() => installReloadGuards(() => setTick(n => n + 1)), []);

  useEffect(() => {
    if (origin === null) return;
    let alive = true;
    let polling = false;
    const poll = () => {
      if (AppState.currentState !== "active" || polling) return;
      polling = true;
      void (async () => {
        try {
          const manifest = await fetchServedBuild(origin, fetch);
          if (!alive) return;
          if (manifest === null) {
            // Metro may have restarted into a different bundle; revalidate after an outage.
            if (latestManifest.current) healthyAssets.current.delete(latestManifest.current.key);
            verifiedKey.current = null;
            setBundleHealth(null);
            return;
          }
          const { build, launchAssetUrl } = manifest;
          const key = origin + "|" + build.sha;
          if (latestManifest.current?.key !== key || latestManifest.current.launchAssetUrl !== launchAssetUrl) {
            verifiedKey.current = null;
            setBundleHealth(null);
          }
          latestManifest.current = { key, origin, build, launchAssetUrl };
          setServed(build);
          if (runningSha === null || runningSha === build.sha) {
            verifiedKey.current = null;
            setBundleHealth(null);
            return;
          }
          if (healthyAssets.current.get(key) === launchAssetUrl) {
            verifiedKey.current = key;
            setBundleHealth({ sha: build.sha, origin, state: "healthy" });
            return;
          }
          const health = await probeLaunchAsset(launchAssetUrl, fetch);
          if (!alive || latestManifest.current?.key !== key || latestManifest.current.launchAssetUrl !== launchAssetUrl) return;
          if (health.ok) {
            healthyAssets.current.set(key, launchAssetUrl);
            verifiedKey.current = key;
            setBundleHealth({ sha: build.sha, origin, state: "healthy" });
          } else {
            verifiedKey.current = null;
            setBundleHealth({ sha: build.sha, origin, state: "failed", reason: health.reason });
          }
        } finally {
          polling = false;
        }
      })();
    };
    poll();
    const timer = setInterval(poll, webPollMs() ?? POLL_MS);
    // Re-evaluate the idle gate between polls while an update waits.
    const tick = setInterval(() => setTick((n) => n + 1), Platform.OS === "web" ? 250 : 5_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (Platform.OS !== "web") foregroundAt.current = Date.now();
      poll();
    });
    return () => {
      alive = false;
      verifiedKey.current = null;
      latestManifest.current = null;
      clearInterval(timer);
      clearInterval(tick);
      sub.remove();
    };
  }, [origin, runningSha]);

  // Only actually RUNNING the attempted SHA proves its reload succeeded.
  // A Metro rollback to the old SHA must not erase the failed SHA's retry marker.
  useEffect(() => {
    if (runningSha !== null && lastAutoFor === runningSha) {
      setLastAutoFor(null);
      void writePref(TRIED_KEY, null);
    }
  }, [runningSha, lastAutoFor]);

  const blockedBy = reloadBlockedBy();
  const automaticEnabled = autoReload && prefsReady;
  const reloadInput: ReloadInput = {
    running,
    served,
    origin,
    bundleHealth,
    autoReload: automaticEnabled,
    sinceForegroundMs: foregroundAt.current === null ? Number.POSITIVE_INFINITY : Date.now() - foregroundAt.current,
    idleMs: idleMs(),
    idleReloadMs: webIdleReloadMs(),
    keyboardVisible: keyboardVisible(),
    blockedBy,
    heldFor: heldFor.current,
    lastAutoFor,
  };
  const latestReloadInput = useRef(reloadInput);
  latestReloadInput.current = reloadInput;
  const decision = decideReload(reloadInput);
  const blocked = decision.kind === "ready" && decision.why === "blocked";
  useEffect(() => {
    if (blocked && served !== null && automaticEnabled && latestReloadInput.current.autoReload) heldFor.current = served.sha;
  }, [blocked, served, automaticEnabled]);

  const requestReload = useCallback((automatic: boolean) => {
    const target = latestManifest.current;
    const needsBundleCheck = target !== null && runningSha !== null && target.build.sha !== runningSha;
    const sameTarget = () => latestManifest.current?.key === target?.key &&
      latestManifest.current?.launchAssetUrl === target?.launchAssetUrl;
    const healthy = () => sameTarget() && (!needsBundleCheck || (target !== null && verifiedKey.current === target.key));
    const permitted = () => {
      if (!healthy()) return false;
      if (!automatic) return true;
      return AppState.currentState === "active" && decideReload({
        ...latestReloadInput.current,
        sinceForegroundMs: foregroundAt.current === null ? Number.POSITIVE_INFINITY : Date.now() - foregroundAt.current,
        idleMs: idleMs(),
        keyboardVisible: keyboardVisible(),
        blockedBy: reloadBlockedBy(),
        heldFor: heldFor.current,
      }).kind === "reload";
    };
    if (reloading.current || !permitted()) return;
    reloading.current = true;
    void (async () => {
      let invoked = false, attemptMarked = false;
      try {
        if (needsBundleCheck && target !== null) {
          const health = await probeLaunchAsset(target.launchAssetUrl, fetch);
          if (!sameTarget()) return;
          if (!health.ok) {
            healthyAssets.current.delete(target.key);
            verifiedKey.current = null;
            setBundleHealth({ sha: target.build.sha, origin: target.origin, state: "failed", reason: health.reason });
            return;
          }
        }
        if (!permitted()) return;
        if (automatic && target !== null) {
          await writePref(TRIED_KEY, target.build.sha);
          attemptMarked = true;
        }
        // Persist edits made during every earlier await, including the launch probe.
        await flushDrafts();
        // No await between validating the target/activity and invoking the reload.
        if (!permitted()) return;
        if (automatic && target !== null) setLastAutoFor(target.build.sha);
        invoked = true;
        reloadApp();
      } catch (error) {
        console.warn("[live-update] reload cancelled: drafts could not be persisted", error);
      } finally {
        if (invoked) setTimeout(() => { reloading.current = false; }, 10_000);
        else {
          if (attemptMarked) await writePref(TRIED_KEY, null);
          reloading.current = false;
          setTick(n => n + 1);
        }
      }
    })();
  }, [runningSha]);
  const reloadNow = useCallback(() => requestReload(false), [requestReload]);

  useEffect(() => {
    if (decision.kind === "reload" && served !== null && !reloading.current) requestReload(true);
  }, [decision.kind, served, requestReload]);

  const setAutoReload = useCallback((on: boolean) => {
    latestReloadInput.current = { ...latestReloadInput.current, autoReload: on && prefsReady };
    setAutoState(on);
    if (!on) heldFor.current = null;
    void writePref(AUTO_KEY, on ? null : "0");
  }, [prefsReady]);

  const switchTo = useCallback(
    (endpoint: MetroEndpoint) => {
      const target = origin === null ? null : endpointOrigin(origin, endpoint.port);
      if (target !== null) void Linking.openURL(developmentClientLink(appScheme(), target));
    },
    [origin],
  );

  return { running, served, origin, decision, autoReload, setAutoReload, reloadNow, blockedBy, switchTo };
}
