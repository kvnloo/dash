import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { store } from "../store/app";
import { executionToken } from "./bridge-auth";

export interface BridgeJson<T> { data: T | null; error: string; loadedAt: number | null }

/**
 * Poll one authenticated bridge GET while `enabled` (a visible desk panel). One request in flight,
 * paused in the background, last good value kept on a failed poll.
 */
export function useBridgeJson<T>(path: string, parse: (raw: unknown) => T | null, intervalMs: number, enabled: boolean): BridgeJson<T> {
  const settings = store.use(s => s.settings);
  const address = settings?.address;
  const [state, setState] = useState<BridgeJson<T>>({ data: null, error: "", loadedAt: null });
  useEffect(() => {
    if (!enabled || !address) return;
    const current = store.get().settings;
    if (!current) return;
    let disposed = false, pending = false;
    let controller: AbortController | undefined;
    async function load() {
      if (disposed || pending || AppState.currentState !== "active" || !current) return;
      pending = true;
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch(`http://${current.address}${path}`, { headers: { Authorization: `Bearer ${await executionToken(current)}` }, signal: request.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parse(await response.json());
        if (!parsed) throw new Error("unexpected response");
        if (!disposed) setState({ data: parsed, error: "", loadedAt: Date.now() });
      } catch (error) {
        if (!disposed) setState(s => ({ ...s, error: error instanceof Error && error.name !== "AbortError" ? error.message : "unavailable" }));
      } finally { clearTimeout(timeout); pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    const listener = AppState.addEventListener("change", next => { if (next === "active") void load(); });
    return () => { disposed = true; controller?.abort(); clearInterval(timer); listener.remove(); };
    // `parse` is a module-level parser; the request identity is path + bridge.
  }, [enabled, address, settings?.token, path, intervalMs]);
  return state;
}
