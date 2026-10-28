import { executionToken, type AuthSettings } from "./bridge-auth";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { parseOrchestra, type OrchestraSnapshot } from "../../../shared/orchestra";
type Source = AuthSettings & { address: string };
type Evidence = { source: Source; snapshot: OrchestraSnapshot | null; error: string };

export function useOrchestraEvidence(settings: Source | null, focused: boolean) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => { setEvidence(null); }, [settings?.address, settings?.token, settings?.identity]);
  useEffect(() => {
    if (!settings || !focused) return;
    let disposed = false;
    let pending = false;
    const controller = new AbortController();
    async function load() {
      if (pending || disposed || AppState.currentState !== "active" || !settings) return;
      pending = true;
      try {
        const token = await executionToken(settings);
        if (disposed || controller.signal.aborted || AppState.currentState !== "active") return;
        const response = await fetch(`http://${settings.address}/orchestra/graph`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Graph evidence unavailable (HTTP ${response.status}); roster only.`);
        const parsed = parseOrchestra(await response.json());
        if (!parsed) throw new Error("Invalid graph snapshot; roster only.");
        if (!disposed && AppState.currentState === "active") setEvidence({ source: settings, snapshot: parsed, error: "" });
      } catch (e) {
        if (!disposed && AppState.currentState === "active") setEvidence(previous => ({
          source: settings,
          snapshot: previous && sameSource(previous.source, settings) ? previous.snapshot : null,
          error: e instanceof Error ? e.message : "Graph unavailable",
        }));
      } finally { pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [settings?.address, settings?.token, settings?.identity, focused]);
  const current = settings && evidence && sameSource(settings, evidence.source) ? evidence : null;
  return { snapshot: current?.snapshot ?? null, error: settings ? current?.error ?? "" : "Pair with a bridge to load host evidence." };
}

function sameSource(a: Source, b: Source) {
  return a.address === b.address && a.token === b.token && a.identity === b.identity;
}
