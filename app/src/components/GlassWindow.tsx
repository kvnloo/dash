import { useEffect } from "react";
import { glassWindowState, onCrossWindowBlurChanged, setWindowGlass } from "../lib/glass-window";
import { glassStore, hydrateGlass, setBlurAvailable, useGlassScene } from "../store/glass";
import { glassBuild } from "../theme";

/** Glass build only: keeps the native window blur in step with the scene and battery saver. */
function LiveGlassWindow() {
  const scene = useGlassScene();
  useEffect(() => {
    void hydrateGlass();
    setBlurAvailable(glassWindowState().crossWindowBlurEnabled);
    return onCrossWindowBlurChanged(setBlurAvailable);
  }, []);
  useEffect(() => {
    // Ask for the user's radius even while the scene says 0 (blur unknown/off): native decides
    // from isCrossWindowBlurEnabled, and the answer updates blurAvailable.
    const { prefs } = glassStore.get();
    const want = scene.active ? prefs.blur : 0;
    void setWindowGlass({ blurRadius: want, behindRadius: scene.behindBlur }).then(state => setBlurAvailable(state.crossWindowBlurEnabled));
  }, [scene.active, scene.windowBlur, scene.behindBlur, scene.tint]);
  return null;
}

export const GlassWindow = glassBuild ? LiveGlassWindow : () => null;
