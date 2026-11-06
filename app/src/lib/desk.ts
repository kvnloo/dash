import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { createStore } from "../store/createStore";
import type { DexState } from "./dex-types";

/**
 * Desk mode: the multi-pane dashboard Dash shows in Samsung DeX or any wide window. The phone
 * layout is untouched below the thresholds; the owner (Settings) or a URL (`?desk=on|off|auto`,
 * web only, not persisted) can force it either way.
 */
export type DeskChoice = "auto" | "on" | "off";
export const DESK_CHOICES: readonly DeskChoice[] = ["auto", "on", "off"];

/** Wide-window threshold (dp / CSS px) with no other signal. */
export const DESK_MIN_WIDTH = 1100;
/** A desktop signal (DeX display, desk ui mode, a mouse on native) lowers it. */
export const DESK_SIGNAL_MIN_WIDTH = 960;

export type DeskReason = "setting-on" | "setting-off" | "url-on" | "url-off" | "dex" | "pointer" | "wide" | "narrow" | "unpaired";

export interface DeskInput {
  choice: DeskChoice;
  urlChoice: DeskChoice | null;
  width: number;
  dex: Pick<DexState, "mode" | "desktop">;
  /** Native: a mouse/trackpad is attached. Web never sets it (every desktop browser has one). */
  pointer: boolean;
}

export function deskDecision(input: DeskInput): { on: boolean; reason: DeskReason } {
  if (input.urlChoice === "on") return { on: true, reason: "url-on" };
  if (input.urlChoice === "off") return { on: false, reason: "url-off" };
  if (input.choice === "on") return { on: true, reason: "setting-on" };
  if (input.choice === "off") return { on: false, reason: "setting-off" };
  if (input.width >= DESK_MIN_WIDTH) return { on: true, reason: "wide" };
  if (input.width >= DESK_SIGNAL_MIN_WIDTH && (input.dex.mode !== "off" || input.dex.desktop === true)) return { on: true, reason: "dex" };
  if (input.width >= DESK_SIGNAL_MIN_WIDTH && input.pointer) return { on: true, reason: "pointer" };
  return { on: false, reason: "narrow" };
}

export function parseDeskChoice(raw: unknown): DeskChoice | null {
  return DESK_CHOICES.find(choice => choice === raw) ?? null;
}

/** Web only: `?desk=on|off|auto` for the army and for a quick look; read once per page load. */
export const URL_DESK_CHOICE: DeskChoice | null = Platform.OS === "web" && typeof location !== "undefined"
  ? parseDeskChoice(new URLSearchParams(location.search).get("desk"))
  : null;

/** Panels in rail order. Ctrl+1..9 focus the panel at that position. */
export const DESK_PANELS = [
  { id: "hosts", label: "Hosts" },
  { id: "chats", label: "Chats" },
  { id: "orchestra", label: "Orchestra" },
  { id: "phones", label: "Phone queue" },
  { id: "workers", label: "Workers" },
  { id: "needs", label: "Needs you" },
  { id: "traces", label: "Traces" },
  { id: "build", label: "Build" },
  { id: "chat", label: "Open chat" },
] as const;
export type DeskPanelId = typeof DESK_PANELS[number]["id"];
export function isDeskPanelId(value: string): value is DeskPanelId { return DESK_PANELS.some(panel => panel.id === value); }

export const LEFT_WIDTH = { min: 240, max: 520, initial: 320 } as const;
export const RIGHT_WIDTH = { min: 280, max: 640, initial: 380 } as const;
export const clampWidth = (bounds: { min: number; max: number }, value: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));

export interface DeskPrefs {
  choice: DeskChoice;
  leftWidth: number;
  rightWidth: number;
  collapsed: Partial<Record<DeskPanelId, boolean>>;
}
export const DEFAULT_DESK_PREFS: DeskPrefs = { choice: "auto", leftWidth: LEFT_WIDTH.initial, rightWidth: RIGHT_WIDTH.initial, collapsed: {} };

export function parseDeskPrefs(raw: unknown): DeskPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_DESK_PREFS;
  const value: Record<string, unknown> = { ...raw };
  const collapsed: Partial<Record<DeskPanelId, boolean>> = {};
  const rawCollapsed = value.collapsed;
  if (typeof rawCollapsed === "object" && rawCollapsed !== null) {
    for (const [key, flag] of Object.entries(rawCollapsed)) if (isDeskPanelId(key) && typeof flag === "boolean") collapsed[key] = flag;
  }
  const width = (bounds: { min: number; max: number; initial: number }, n: unknown) => typeof n === "number" && Number.isFinite(n) ? clampWidth(bounds, n) : bounds.initial;
  return { choice: parseDeskChoice(value.choice) ?? "auto", leftWidth: width(LEFT_WIDTH, value.leftWidth), rightWidth: width(RIGHT_WIDTH, value.rightWidth), collapsed };
}

const KEY = "dash.desk.v1";
export const deskPrefs = createStore<DeskPrefs & { loaded: boolean }>({ ...DEFAULT_DESK_PREFS, loaded: false });

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { choice, leftWidth, rightWidth, collapsed } = deskPrefs.get();
    void AsyncStorage.setItem(KEY, JSON.stringify({ choice, leftWidth, rightWidth, collapsed })).catch(() => {});
  }, 150);
}

let loading: Promise<void> | undefined;
export function loadDeskPrefs(): Promise<void> {
  loading ??= AsyncStorage.getItem(KEY).then(raw => {
    let parsed: unknown = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    deskPrefs.set({ ...parseDeskPrefs(parsed), loaded: true });
  }, () => { deskPrefs.set(s => ({ ...s, loaded: true })); });
  return loading;
}

export function updateDeskPrefs(change: (prefs: DeskPrefs) => Partial<DeskPrefs>) {
  deskPrefs.set(s => ({ ...s, ...change(s) }));
  persist();
}
export const setDeskChoice = (choice: DeskChoice) => updateDeskPrefs(() => ({ choice }));
export const setPanelCollapsed = (id: DeskPanelId, collapsed: boolean) => updateDeskPrefs(s => ({ collapsed: { ...s.collapsed, [id]: collapsed } }));

/** The live desk decision, shared by the shell, Main and the chat rows. */
export const deskState = createStore<{ on: boolean; reason: DeskReason; width: number; signal: string }>({ on: false, reason: "narrow", width: 0, signal: "none" });
export function useDeskActive(): boolean { return deskState.use(s => s.on); }

/** What a desk panel asked to show; panels watch their id and scroll/expand/highlight. */
export const deskFocus = createStore<{ id: DeskPanelId | null; at: number }>({ id: null, at: 0 });
export function focusDeskPanel(id: DeskPanelId) {
  if (deskPrefs.get().collapsed[id]) setPanelCollapsed(id, false);
  deskFocus.set({ id, at: Date.now() });
}
