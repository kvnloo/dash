// Expo dev-client builds (the turbo preview) draw expo-dev-menu's movable "Tools" gear: a 52dp
// button with 16dp margins that snaps to a screen edge at any height and remembers where it was
// dropped (it rests at the right edge by default). It is drawn above React Native, so Dash can
// neither move it nor read its position. Floating Dash overlays (annotation tray, Learn/Quick
// panels) keep the right edge column clear instead, so the gear never covers their chips.
// Release builds have no gear and keep the full width. Pure: no React Native imports.

export const DEV_TOOLS_BUTTON = 52;
export const DEV_TOOLS_MARGIN = 16;
/** Right-edge column the gear can rest in: its own width plus its margin from the edge. */
export const DEV_TOOLS_GUTTER = DEV_TOOLS_BUTTON + DEV_TOOLS_MARGIN;

export interface DevToolsEnv {
  /** __DEV__: the bundle is a development bundle. */
  dev: boolean;
  os: string;
  /** The ExpoDevMenu native module is linked (dev-client native build). */
  devMenu: boolean;
  /** Web army only: simulate the gear (`?devToolsGutter=1`). */
  forced: boolean;
}

export function devToolsGutter(env: DevToolsEnv): number {
  if (env.forced) return DEV_TOOLS_GUTTER;
  return env.dev && env.devMenu && (env.os === "android" || env.os === "ios") ? DEV_TOOLS_GUTTER : 0;
}
