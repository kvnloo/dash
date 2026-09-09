/**
 * React Native defines `window` but not `window.location`.
 * Expo devtools and React Navigation still do `window.location.search`
 * after a `typeof window !== "undefined"` check.
 *
 * This module MUST stay import-free so it runs before `react-native` /
 * `@expo/devtools` load.
 */
const stub = {
  href: "http://localhost/",
  origin: "http://localhost",
  protocol: "http:",
  host: "localhost",
  hostname: "localhost",
  port: "",
  pathname: "/",
  search: "",
  hash: "",
  assign() {},
  replace() {},
  reload() {},
  toString() {
    return this.href;
  },
};

function needsLocation(target: object): boolean {
  try {
    const loc = (target as { location?: { search?: unknown } }).location;
    return loc == null || typeof loc.search !== "string";
  } catch {
    return true;
  }
}

function install(target: object): void {
  if (!needsLocation(target)) return;
  try {
    Object.defineProperty(target, "location", {
      configurable: true,
      enumerable: true,
      get() {
        return stub;
      },
      set() {},
    });
    return;
  } catch {
    /* non-configurable getter */
  }
  try {
    (target as { location: typeof stub }).location = stub;
  } catch {
    /* frozen */
  }
}

const g = globalThis as typeof globalThis & { window?: object; global?: object };
install(g);
if (typeof g.window === "object" && g.window) install(g.window);
if (typeof g.global === "object" && g.global && g.global !== g) install(g.global);
