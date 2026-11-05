import { executionToken } from "./bridge-auth";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { parseZ0LiveState, type Z0LiveState } from "../../../shared/z0live-state";
import type { Settings } from "../model";

/**
 * Read-only poll of the bridge's z0live projection (`GET /z0live/state`), at most 1 Hz.
 * One request in flight; paused while the app is backgrounded; undefined when unknown.
 */
export function useZ0LiveState(settings: Settings | null, enabled: boolean, intervalMs = 1000): Z0LiveState | undefined {
  const [sample, setSample] = useState<{ key: string; state: Z0LiveState }>();
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
        const response = await fetch(`http://${settings.address}/z0live/state`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal });
        const state = response.ok ? parseZ0LiveState(await response.json()) : undefined;
        if (!disposed) setSample(state ? { key, state } : undefined);
      } catch { if (!disposed) setSample(undefined); }
      finally { clearTimeout(timeout); if (!disposed) timer = setTimeout(poll, every); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [settings?.address, settings?.token, enabled, every, key]);
  return enabled && sample?.key === key ? sample.state : undefined;
}
