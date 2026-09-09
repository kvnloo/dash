import type { RootStackParamList } from "../navigation";
import { setActive, store } from "../store/app";
import { debugNavigate, debugResetTo, flushPendingDebugNavigation, waitForDebugNavigation } from "./nav";
import { applyDebugSeed, type DebugSeedVariant } from "./seed";
import {
  DEBUG_SCENARIO_IDS,
  DEBUG_SCENARIOS,
  resolveScenarioId,
  type DebugScenarioId,
} from "./scenarios";
import { debugUi } from "./ui-store";

export type DebugCommand =
  | { action: "scenario"; id: DebugScenarioId }
  | { action: "navigate"; screen: keyof RootStackParamList; params?: RootStackParamList[keyof RootStackParamList] }
  | { action: "reset"; seed?: DebugSeedVariant }
  | { action: "setSearch"; query: string }
  | { action: "setMainTab"; index: number }
  | { action: "setHarnessPicker"; open: boolean }
  | { action: "setActiveChat"; conversationId: string | null }
  | { action: "setConnection"; status: "online" | "offline" | "connecting" | "idle" }
  | { action: "wait"; ms: number }
  | { action: "listScenarios" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyScenarioUi(spec: (typeof DEBUG_SCENARIOS)[DebugScenarioId]): void {
  debugUi.set((s) => ({
    ...s,
    mainSearchQuery: spec.ui?.mainSearchQuery ?? null,
    mainTabIndex: spec.ui?.mainTabIndex ?? null,
    chatHarnessPickerOpen: spec.ui?.chatHarnessPickerOpen ?? null,
  }));
  if (spec.ui?.activeConversationId) {
    setActive(spec.ui.activeConversationId);
  }
}

export async function runScenario(id: DebugScenarioId): Promise<void> {
  const spec = DEBUG_SCENARIOS[id];
  applyDebugSeed(spec.seed);
  applyScenarioUi(spec);
  await waitForDebugNavigation();
  debugResetTo(spec.route.name, spec.route.params);
  flushPendingDebugNavigation();
  await sleep(200);
  debugUi.set((s) => ({ ...s, ready: true }));
}

export async function runDebugCommand(cmd: DebugCommand): Promise<unknown> {
  switch (cmd.action) {
    case "listScenarios":
      return DEBUG_SCENARIO_IDS.map((id) => ({ id, label: DEBUG_SCENARIOS[id].label }));
    case "scenario":
      await runScenario(cmd.id);
      return { ok: true, id: cmd.id };
    case "navigate":
      await waitForDebugNavigation();
      debugNavigate(cmd.screen, cmd.params);
      flushPendingDebugNavigation();
      return { ok: true };
    case "reset":
      applyDebugSeed(cmd.seed ?? "paired");
      return { ok: true };
    case "setSearch":
      debugUi.set((s) => ({ ...s, mainSearchQuery: cmd.query }));
      return { ok: true };
    case "setMainTab":
      debugUi.set((s) => ({ ...s, mainTabIndex: cmd.index }));
      return { ok: true };
    case "setHarnessPicker":
      debugUi.set((s) => ({ ...s, chatHarnessPickerOpen: cmd.open }));
      return { ok: true };
    case "setActiveChat":
      setActive(cmd.conversationId);
      return { ok: true };
    case "setConnection":
      store.set((s) => ({ ...s, connection: { ...s.connection, status: cmd.status } }));
      return { ok: true };
    case "wait":
      await sleep(cmd.ms);
      return { ok: true };
    default:
      return { ok: false, error: "unknown command" };
  }
}

export async function bootstrapDebugScenario(scenarioRaw: string | undefined): Promise<void> {
  const id = resolveScenarioId(scenarioRaw);
  if (!id) {
    applyDebugSeed("paired");
    debugUi.set((s) => ({ ...s, ready: true }));
    return;
  }
  await runScenario(id);
  debugUi.set((s) => ({ ...s, ready: true }));
}
