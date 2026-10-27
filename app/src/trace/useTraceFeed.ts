import { useEffect } from "react";
import type { AuthSettings } from "../lib/bridge-auth";
import { AppState } from "react-native";
import { fetchTraceSnapshot } from "./feed";
import { TRACE_POLL_MS, unavailableReason } from "./feed-state";
import { resetTraceFeed, setTraceSnapshot, setTraceUnavailable } from "./source";

/**
 * Foreground polling of the paired bridge's /trace/snapshot. Pairing changes discard the
 * previous host's data. Leaving the screen pauses polling but keeps the last view, so
 * Trace -> Lab -> Back returns to the same rows; refocus polls at once.
 */
export function useTraceFeed(settings: (AuthSettings & { address: string }) | null, focused = true): void {
  const address = settings?.address, token = settings?.token, identity = settings?.identity;
  useEffect(() => { resetTraceFeed(Boolean(address && (token || identity))); }, [address, token, identity]);
  useEffect(() => {
    if (!address || !(token || identity) || !focused) return;
    let disposed = false, pending = false;
    let controller: AbortController | undefined;
    async function load() {
      if (disposed || pending || AppState.currentState !== "active" || !address || token === undefined || !(token || identity)) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const snapshot = await fetchTraceSnapshot({ address, token, identity }, controller.signal);
        if (!disposed) setTraceSnapshot(snapshot);
      } catch (error) {
        if (!disposed) setTraceUnavailable(unavailableReason(error));
      } finally { clearTimeout(timeout); pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), TRACE_POLL_MS);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void load(); });
    return () => { disposed = true; controller?.abort(); clearInterval(timer); listener.remove(); };
  }, [address, token, identity, focused]);
}
