import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { executionToken } from "./bridge-auth";
import { parseHostUtilization, type UtilizationSnapshot } from "../../../shared/host-utilization";

export function useHostUtilization(settings: { address: string; token: string } | null, focused: boolean) {
  const [snapshot, setSnapshot] = useState<UtilizationSnapshot | null>(null);
  useEffect(() => {
    setSnapshot(null);
    if (!settings || !focused) return;
    let disposed = false, pending = false;
    const controller = new AbortController();
    async function load() {
      if (pending || disposed || AppState.currentState !== "active" || !settings) return;
      pending = true;
      try {
        const response = await fetch(`http://${settings.address}/hosts/utilization`, {
          headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal,
        });
        const parsed = response.ok ? parseHostUtilization(await response.json()) : null;
        if (!disposed) setSnapshot(parsed);
      } catch { if (!disposed) setSnapshot(null); }
      finally { pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 60000);
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") void load();
      else setSnapshot(null);
    });
    return () => { disposed = true; controller.abort(); clearInterval(timer); listener.remove(); };
  }, [settings?.address, settings?.token, focused]);
  return snapshot;
}
