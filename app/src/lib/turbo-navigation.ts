import AsyncStorage from "@react-native-async-storage/async-storage";
import type { InitialState } from "@react-navigation/native";
import { debugNavigationRef } from "../debug/nav";
import { store } from "../store/app";
import { DEFAULT_MAIN_TAB } from "./home";
import { turboRequests } from "./turbo-request";

const KEY = "dash.turbo.navigation.v1";
let mainTab = DEFAULT_MAIN_TAB;
let lastSaved: string | undefined;
let write = Promise.resolve();
const plainRoutes = new Set(["Approvals", "Notices", "Settings", "Trace", "Lab", "Roadmap", "Voice"]);

function isTab(value: unknown): value is number {
  return value === 0 || value === 1 || value === 2;
}

export function noteTurboTab(tab: number): void {
  if (!turboRequests || !isTab(tab) || mainTab === tab) return;
  mainTab = tab;
  saveTurboNavigation();
}

function safeParams(name: string, raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "object" || raw === null) return;
  const key = name === "OrchestraDetail" ? "orchestraId" : name === "RoadmapProject" ? "projectId" : name === "RoadmapTask" ? "taskId" : null;
  if (!key) return;
  const id: unknown = Reflect.get(raw, key);
  if (typeof id !== "string" || !/^[\w:.-]{1,160}$/.test(id)) return;
  const feature: unknown = name === "RoadmapProject" ? Reflect.get(raw, "feature") : undefined;
  return { [key]: id, ...(typeof feature === "string" && /^[\w.-]{1,160}$/.test(feature) ? { feature } : {}) };
}

export function saveTurboNavigation(): void {
  if (!turboRequests || !debugNavigationRef.isReady() || !store.get().settings) return;
  const route = debugNavigationRef.getCurrentRoute();
  if (!route) return;
  // Do not serialize navigation state: it can carry connection credentials, draft text,
  // arbitrary HTML, or an autostart bit that would reopen the mic after a reload.
  const payload = JSON.stringify({
    tab: mainTab, name: route.name, params: safeParams(route.name, route.params),
    chat: route.name === "Chat" ? store.get().activeId : undefined,
  });
  if (lastSaved === payload) return;
  lastSaved = payload;
  write = write.then(() => AsyncStorage.setItem(KEY, payload)).catch(() => {
    if (lastSaved === payload) lastSaved = undefined;
  });
}

export async function flushTurboNavigation(): Promise<void> {
  saveTurboNavigation();
  await write;
}

export async function restoreTurboNavigation(): Promise<InitialState | undefined> {
  if (!turboRequests || !store.get().settings) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved: unknown = raw && JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("tab" in saved) || !isTab(saved.tab)) return;
    mainTab = saved.tab;
    const routes: { name: string; params?: object }[] = [{ name: "Main", params: { tab: mainTab } }];
    if ("name" in saved && typeof saved.name === "string") {
      const params = safeParams(saved.name, "params" in saved ? saved.params : undefined);
      if (params || plainRoutes.has(saved.name)) routes.push({ name: saved.name, params });
      if (saved.name === "Chat" && "chat" in saved && typeof saved.chat === "string" &&
          saved.chat === store.get().activeId) routes.push({ name: "Chat" });
    }
    return { index: routes.length - 1, routes };
  } catch {
    // Missing or corrupt preview navigation is not a boot failure.
  }
}
