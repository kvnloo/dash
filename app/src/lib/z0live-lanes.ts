import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { parseZ0LiveLanesState, type Z0LiveLanes } from "../../../shared/z0live-lanes";
import type { Settings } from "../model";
import { executionToken } from "./bridge-auth";

export interface LaneSample { lanes: Z0LiveLanes; /** Bridge clock minus this device's clock, in seconds. */ offset: number }

/**
 * Poll the bridge's lane projection (`GET /z0live/lanes`) at most 1 Hz: one request in flight,
 * paused while backgrounded. A failed poll keeps the last good sample so the panel does not flicker.
 */
export function useZ0LiveLanes(settings: Settings | null, enabled: boolean, intervalMs = 1000): LaneSample | undefined {
  const [sample, setSample] = useState<{ key: string; value: LaneSample }>();
  const key = `${settings?.address}`;
  const every = Math.max(1000, intervalMs);
  useEffect(() => {
    if (!settings || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState !== "active") { timer = setTimeout(poll, every * 2); return; }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 900);
      try {
        const response = await fetch(`http://${settings.address}/z0live/lanes`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal });
        if (response.ok) {
          const lanes = parseZ0LiveLanesState(await response.json());
          if (!disposed) setSample({ key, value: { lanes, offset: lanes.now ? lanes.now - Date.now() / 1000 : 0 } });
        }
      } catch { /* keep the last sample */ }
      finally { clearTimeout(timeout); if (!disposed) timer = setTimeout(poll, every); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [settings?.address, settings?.token, enabled, every, key]);
  return enabled && sample?.key === key ? sample.value : undefined;
}
