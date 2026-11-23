import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import { Platform, type ViewStyle } from "react-native";
import { createStore } from "../store/createStore";

/**
 * Visual theme. "night" is Living Night, the default, and renders exactly as before.
 * "blueprint" is the themed mode: the blueprint Living Ruins wallpaper behind every screen
 * and elemental-ui stone buttons and panels.
 */
export type ThemeMode = "night" | "blueprint";
export const THEME_MODES: readonly ThemeMode[] = ["night", "blueprint"];
const KEY = "dash.theme.mode";

export function parseThemeMode(value: unknown): ThemeMode | null {
  return value === "night" || value === "blueprint" ? value : null;
}

/** Web only: `?theme=blueprint|night` wins over the saved choice (tests and debugging). */
export const URL_THEME_MODE: ThemeMode | null = Platform.OS === "web" && typeof location !== "undefined"
  ? parseThemeMode(new URLSearchParams(location.search).get("theme"))
  : null;

/** Stone of the elemental-ui buttons in themed mode. */
export type ThemeMaterial = "basalt" | "slate" | "limestone";
export const THEME_MATERIALS: readonly ThemeMaterial[] = ["basalt", "slate", "limestone"];
const MATERIAL_KEY = "dash.theme.material";
function parseMaterial(value: unknown): ThemeMaterial | null {
  return value === "basalt" || value === "slate" || value === "limestone" ? value : null;
}

export const themeMode = createStore<{ mode: ThemeMode; material: ThemeMaterial; loaded: boolean }>({ mode: URL_THEME_MODE ?? "night", material: "basalt", loaded: false });

let loading: Promise<void> | null = null;
export function loadThemeMode(): Promise<void> {
  return loading ??= Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(MATERIAL_KEY)]).catch(() => [null, null]).then(([saved, material]) => {
    const mode = URL_THEME_MODE ?? parseThemeMode(saved) ?? "night";
    themeMode.set({ mode, material: parseMaterial(material) ?? "basalt", loaded: true });
  });
}

export function setThemeMode(mode: ThemeMode) {
  themeMode.set(s => ({ ...s, mode, loaded: true }));
  void AsyncStorage.setItem(KEY, mode).catch(() => {});
}

export function setThemeMaterial(material: ThemeMaterial) {
  themeMode.set(s => ({ ...s, material }));
  void AsyncStorage.setItem(MATERIAL_KEY, material).catch(() => {});
}

export function useThemed(): boolean {
  return themeMode.use(s => s.mode === "blueprint");
}

const CLEAR: ViewStyle = { backgroundColor: "transparent" };
const CLEAR_HIDDEN: ViewStyle = { backgroundColor: "transparent", opacity: 0 };

/**
 * Screen root style in themed mode: transparent so the root wallpaper shows through, and
 * hidden while another screen is on top (a transparent screen above would show it through).
 * `keepVisible` keeps it painted under a floating chat window. Living Night: no style at all.
 *
 * The root View that takes this style must set `collapsable={false}`. A transparent View with no
 * other native-view prop is flattened away by Fabric, and `opacity: 0` makes it a real view again,
 * so without the pin every navigation that covers the screen re-parents all of its children in the
 * same mount batch. On Android that crashed opening Settings from Chats in Blueprint
 * (`addViewAt: failed to insert view into parent at index 1`, S25).
 */
export function useThemedSurface(keepVisible = false): ViewStyle | undefined {
  const themed = useThemed();
  const focused = useIsFocused();
  if (!themed) return undefined;
  return focused || keepVisible ? CLEAR : CLEAR_HIDDEN;
}
