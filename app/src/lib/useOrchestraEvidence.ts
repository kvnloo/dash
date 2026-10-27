import { executionToken } from "./bridge-auth";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { parseOrchestra, type OrchestraSnapshot } from "../../../shared/orchestra";
export function useOrchestraEvidence(settings: { address: string; token: string } | null) {
  const [snapshot, setSnapshot] = useState<OrchestraSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setSnapshot(null);
    if (!settings) { setError("Pair with a bridge to load host evidence."); return; }
    let disposed = false;
    let pending = false;
    const controller = new AbortController();
    async function load() {
      if (pending || disposed || AppState.currentState !== "active" || !settings) return;
      pending = true;
      try {
        const response = await fetch(`http://${settings.address}/orchestra/graph`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Graph evidence unavailable (HTTP ${response.status}); roster only.`);
        const parsed = parseOrchestra(await response.json());
        if (!parsed) throw new Error("Invalid graph snapshot; roster only.");
        if (!disposed) { setSnapshot(parsed); setError(""); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Graph unavailable"); }
      finally { pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void load(); });
    return () => { disposed = true; controller.abort(); clearInterval(timer); listener.remove(); };
  }, [settings?.address, settings?.token]);
  return { snapshot, error };
}
