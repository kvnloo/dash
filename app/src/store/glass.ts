import AsyncStorage from "@react-native-async-storage/async-storage";
import { CLASSIC_SCENE, GLASS_DEFAULTS, clampBlur, clampTint, parseGlassPrefs, resolveGlassScene, type GlassPrefs, type GlassScene } from "../lib/glass-theme";
import { glassBuild } from "../theme";
import { createStore } from "./createStore";

const KEY = "dash.glass.v1";

interface GlassState {
  readonly prefs: GlassPrefs;
  /** Live WindowManager.isCrossWindowBlurEnabled(); null until the native module answers. */
  readonly blurAvailable: boolean | null;
  readonly scene: GlassScene;
}

const initial = (prefs: GlassPrefs, blurAvailable: boolean | null): GlassState =>
  ({ prefs, blurAvailable, scene: resolveGlassScene(prefs, glassBuild, blurAvailable) });

export const glassStore = createStore<GlassState>(initial(GLASS_DEFAULTS, null));

/** Kept apart from bridge Settings so it works before pairing and survives "forget everything". */
export async function hydrateGlass(): Promise<void> {
  if (!glassBuild) return;
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  glassStore.set(s => initial(parseGlassPrefs(parsed), s.blurAvailable));
}

export function setGlassPrefs(patch: Partial<GlassPrefs>): void {
  if (!glassBuild) return;
  glassStore.set(s => {
    const prefs: GlassPrefs = {
      mode: patch.mode ?? s.prefs.mode,
      tint: clampTint(patch.tint ?? s.prefs.tint),
      blur: clampBlur(patch.blur ?? s.prefs.blur),
    };
    void AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
    return initial(prefs, s.blurAvailable);
  });
}

export function setBlurAvailable(blurAvailable: boolean): void {
  glassStore.set(s => s.blurAvailable === blurAvailable ? s : initial(s.prefs, blurAvailable));
}

function useLiveGlassScene(): GlassScene { return glassStore.use(s => s.scene); }
function useClassicScene(): GlassScene { return CLASSIC_SCENE; }

/** Classic build: a constant, no subscription. Chosen once at module load, so hook order is stable. */
export const useGlassScene: () => GlassScene = glassBuild ? useLiveGlassScene : useClassicScene;
export const useGlassPrefs = (): GlassPrefs => glassStore.use(s => s.prefs);
export const useBlurAvailable = (): boolean | null => glassStore.use(s => s.blurAvailable);
