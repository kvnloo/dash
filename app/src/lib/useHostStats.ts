import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { parseHostStats, type HostStats } from "../../../shared/protocol";
import { executionToken } from "./bridge-auth";

/** Mounted only by a visible sheet; never updates the roster or conversation store. */
export function useHostStats(settings: { address: string; token: string } | null, hostId: string | undefined) {
  const [snapshot, setSnapshot] = useState<HostStats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setSnapshot(null);
    setError("");
    if (!settings || !hostId) return;
    let disposed = false, pending = false;
    let controller: AbortController | undefined;
    async function load() {
      if (disposed || pending || AppState.currentState !== "active" || !settings) return;
      pending = true;
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch(`http://${settings.address}/hosts/stats`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: request.signal });
        if (!response.ok) throw new Error(`Stats unavailable (HTTP ${response.status})`);
        const parsed = parseHostStats(await response.json());
        if (!parsed || parsed.hostId !== hostId || Date.now() - parsed.sampledAt > 30000) throw new Error("Stats unavailable for this host");
        if (!disposed && AppState.currentState === "active") { setSnapshot(parsed); setError(""); }
      } catch { if (!disposed) { setSnapshot(null); setError("Stats unavailable"); } }
      finally { clearTimeout(timeout); pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    const listener = AppState.addEventListener("change", state => {
      setSnapshot(null);
      if (state === "active") void load();
    });
    return () => { disposed = true; controller?.abort(); clearInterval(timer); listener.remove(); };
  }, [settings?.address, settings?.token, hostId]);
  return { snapshot, error };
}
