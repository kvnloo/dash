import { useEffect } from "react";
import { AppState } from "react-native";
import { executionToken } from "../lib/bridge-auth";
import { store } from "../store/app";
import { bedtimeSchedule, hostSleepUntil } from "../store/bedtime";

const POLL_MS = 60_000;
const TTL_MS = 90_000;

function isHostSleep(value: unknown): boolean {
  return value !== null && typeof value === "object"
    && "schema" in value && value.schema === "dash.posture_view/v1"
    && "source" in value && value.source === "circadiand"
    && "phase" in value && (value.phase === "WIND_DOWN" || value.phase === "PRE_SLEEP" || value.phase === "SLEEP");
}

/** Only hold the derived sleep bit, never wearable records or the raw posture payload. */
export function useHostSleepPosture() {
  const settings = store.use(s => s.settings);
  const follows = bedtimeSchedule.use(s => s?.enabled === true && s.followHost);
  useEffect(() => {
    hostSleepUntil.set(0);
    if (!settings || !follows) return;
    const lifetime = new AbortController();
    let pending = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (pending || AppState.currentState === "background" || AppState.currentState === "inactive") return;
      pending = true;
      let quiet = false;
      try {
        const token = await executionToken(settings);
        const request = new AbortController();
        const abort = () => request.abort();
        if (lifetime.signal.aborted) return;
        lifetime.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 5000);
        try {
          const response = await fetch(`http://${settings.address}/posture`, {
            headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: request.signal,
          });
          if (response.ok) quiet = isHostSleep(await response.json());
        } finally {
          clearTimeout(timeout);
          lifetime.signal.removeEventListener("abort", abort);
        }
      } catch { /* No fresh host signal: use the local schedule. */ }
      finally {
        pending = false;
        if (!lifetime.signal.aborted) {
          if (expiry !== undefined) clearTimeout(expiry);
          hostSleepUntil.set(quiet ? Date.now() + TTL_MS : 0);
          if (quiet) expiry = setTimeout(() => hostSleepUntil.set(0), TTL_MS);
        }
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => {
      lifetime.abort();
      clearInterval(interval);
      if (expiry !== undefined) clearTimeout(expiry);
      listener.remove();
    };
  }, [settings, follows]);
}
