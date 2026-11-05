import { useEffect } from "react";
import { AppState } from "react-native";
import { parsePmDocument, type PmDocument } from "../../../shared/pm";
import { executionToken } from "../lib/bridge-auth";
import { createStore } from "./createStore";
import { store } from "./app";

/** The Roadmap screens' one document (GET /pm): projects, features and tasks from the repos' git ledgers. */
interface PmState { doc: PmDocument | null; loading: boolean; error: string; loadedAt: number }
export const pm = createStore<PmState>({ doc: null, loading: false, error: "", loadedAt: 0 });

let inflight: Promise<void> | undefined;

export function refreshPm(): Promise<void> {
  inflight ??= (async () => {
    const settings = store.get().settings;
    if (!settings) { pm.set(s => ({ ...s, error: "Pair with a bridge to load the roadmap." })); return; }
    pm.set(s => ({ ...s, loading: true }));
    try {
      const response = await fetch(`http://${settings.address}/pm`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` } });
      if (!response.ok) throw new Error(response.status === 404 ? "This bridge has no roadmap yet. Update the bridge." : `Roadmap unavailable (HTTP ${response.status}).`);
      const doc = parsePmDocument(await response.json());
      if (!doc) throw new Error("The bridge sent an unreadable roadmap.");
      pm.set({ doc, loading: false, error: "", loadedAt: Date.now() });
    } catch (e) {
      pm.set(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Roadmap unavailable." }));
    }
  })().finally(() => { inflight = undefined; });
  return inflight;
}

/** Load on open, then every 30 s while the app is in front. */
export function usePmRefresh(): void {
  useEffect(() => {
    void refreshPm();
    const timer = setInterval(() => { if (AppState.currentState === "active") void refreshPm(); }, 30_000);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void refreshPm(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
}
