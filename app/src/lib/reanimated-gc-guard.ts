/**
 * Guard for react-native-reanimated 4.5.x PropsRegistryGarbageCollector.
 *
 * Upstream bug: a <GestureDetector> wrapping an <Animated.View> registers ONE view tag
 * twice. `registerView` skips the second call, but `unregisterView` decrements
 * `viewsCount` on both unmounts. Each unmounted PressScale / InteractiveTile therefore
 * leaks one count. When the count reaches 0 while views are still mounted, the
 * 500 ms settle interval is cleared and never comes back. After that, the native
 * props registry is never pruned: every touch re-applies the props of every view
 * that was ever animated, including unmounted ones
 * ("synchronouslyUpdateUIProps failed for tag N"). Each Orchestra view switch adds
 * more, so the app gets slower and slower and input stops responding.
 *
 * The guard keeps `viewsCount` equal to the number of registered tags, so the
 * interval runs while any view is registered and stops only when none are.
 */
export type PropsRegistryGC = {
  viewsCount: number;
  viewsMap: Map<number, unknown>;
  intervalId: unknown;
  registerView(viewTag: number, component: unknown): void;
  unregisterView(viewTag: number): void;
  registerInterval(): void;
  unregisterInterval(): void;
};

const GUARDED = Symbol.for("dash.reanimatedGcGuard");

export function isPropsRegistryGC(value: unknown): value is PropsRegistryGC {
  if (typeof value !== "object" || value === null) return false;
  const gc: Record<string, unknown> = { ...value };
  return typeof gc.viewsCount === "number" && gc.viewsMap instanceof Map
    && typeof gc.registerView === "function" && typeof gc.unregisterView === "function"
    && typeof gc.registerInterval === "function" && typeof gc.unregisterInterval === "function";
}

/** Idempotent. Returns true when the guard is (already) installed. */
export function guardPropsRegistryGC(gc: PropsRegistryGC): boolean {
  if (Reflect.get(gc, GUARDED) === true) return true;
  gc.registerView = function registerView(viewTag: number, component: unknown) {
    if (this.viewsMap.has(viewTag)) return;
    this.viewsMap.set(viewTag, component);
    this.viewsCount = this.viewsMap.size;
    if (this.intervalId === null || this.intervalId === undefined) this.registerInterval();
  };
  gc.unregisterView = function unregisterView(viewTag: number) {
    // The nested component unmounts second and finds its tag already gone: no second decrement.
    if (!this.viewsMap.delete(viewTag)) return;
    this.viewsCount = this.viewsMap.size;
    if (this.viewsCount === 0) this.unregisterInterval();
  };
  // Repair a count that already drifted (for example after a fast refresh).
  gc.viewsCount = gc.viewsMap.size;
  if (gc.viewsCount > 0 && (gc.intervalId === null || gc.intervalId === undefined)) gc.registerInterval();
  Reflect.set(gc, GUARDED, true);
  return true;
}

/** Loads Reanimated's own module instance (Metro resolves the package to src/). */
export function installReanimatedGcGuard(load: () => unknown): boolean {
  let mod: unknown;
  try { mod = load(); } catch { return false; }
  if (typeof mod !== "object" || mod === null) return false;
  const gc: unknown = Reflect.get(mod, "PropsRegistryGarbageCollector");
  return isPropsRegistryGC(gc) ? guardPropsRegistryGC(gc) : false;
}
