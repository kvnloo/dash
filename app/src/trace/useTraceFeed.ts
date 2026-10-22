import { useEffect } from "react";
import { AppState } from "react-native";
import { fetchTraceSnapshot } from "./feed";
import { setTraceSnapshot, traceStore, resetBundledTrace } from "./source";

/** Screen-scoped, foreground-only polling; pairing changes discard private old-host data. */
export function useTraceFeed(settings: { address: string; token: string } | null): void {
  useEffect(() => {
    resetBundledTrace(settings ? "Connecting to bridge" : "Pair with a bridge for live trace");
    if (!settings) return;
    let disposed = false, pending = false;
    let controller: AbortController | undefined;
    async function load() {
      if (disposed || pending || AppState.currentState !== "active" || !settings) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const snapshot = await fetchTraceSnapshot(settings, controller.signal);
        if (!disposed) setTraceSnapshot(snapshot);
      } catch {
        if (!disposed) resetBundledTrace("Offline / endpoint unavailable · bundled snapshot");
      } finally { clearTimeout(timeout); pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void load(); });
    return () => { disposed = true; controller?.abort(); clearInterval(timer); listener.remove(); traceStore.set(s => ({ ...s, error: "" })); };
  }, [settings?.address, settings?.token]);
}
