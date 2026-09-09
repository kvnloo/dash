import { store } from "../store/app";
import { bootstrapDebugScenario, runDebugCommand, runScenario, type DebugCommand } from "./controller";
import { debugScenarioFromEnv, isDebugMode, readWebDebugParams } from "./mode";
import { DEBUG_SCENARIO_IDS, DEBUG_SCENARIOS, resolveScenarioId, type DebugScenarioId } from "./scenarios";
import { debugUi } from "./ui-store";

export interface DashDebugApi {
  ready: boolean;
  scenarios: { id: DebugScenarioId; label: string }[];
  scenario(id: DebugScenarioId): Promise<void>;
  run(cmd: DebugCommand): Promise<unknown>;
  state(): ReturnType<typeof snapshotDebugState>;
}

function snapshotDebugState() {
  const s = store.get();
  const ui = debugUi.get();
  return {
    settings: s.settings,
    connection: s.connection,
    activeId: s.activeId,
    conversationCount: s.conversations.length,
    ui,
  };
}

declare global {
  interface Window {
    __DASH_DEBUG__?: DashDebugApi;
  }
}

export function exposeDebugApi(): DashDebugApi {
  const api: DashDebugApi = {
    get ready() {
      return debugUi.get().ready;
    },
    scenarios: DEBUG_SCENARIO_IDS.map((id) => ({ id, label: DEBUG_SCENARIOS[id].label })),
    scenario: runScenario,
    run: runDebugCommand,
    state: snapshotDebugState,
  };

  if (typeof window !== "undefined") {
    window.__DASH_DEBUG__ = api;
  }

  return api;
}

export function isDebugActive(): boolean {
  if (isDebugMode()) return true;
  return readWebDebugParams().enabled;
}

export function initialDebugScenario(): string | undefined {
  return debugScenarioFromEnv() ?? readWebDebugParams().scenario;
}

export function parseDebugDeepLink(url: string): DebugScenarioId | null {
  try {
    const parsed = new URL(url.replace(/^dash:\/\//, "https://dash/"));
    if (!parsed.pathname.includes("debug") && parsed.hostname !== "debug") return null;
    const fromQuery = resolveScenarioId(parsed.searchParams.get("scenario") ?? undefined);
    if (fromQuery) return fromQuery;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const scenarioIdx = parts.indexOf("scenario");
    if (scenarioIdx >= 0 && parts[scenarioIdx + 1]) {
      return resolveScenarioId(parts[scenarioIdx + 1]);
    }
    return null;
  } catch {
    return null;
  }
}
