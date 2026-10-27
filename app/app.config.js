// Build variants on top of app.json.
//   default (dev client): app.json unchanged.
//   DASH_VARIANT=release (RC): no expo-dev-client, embedded JS bundle, cleartext ws:// to
//   the tailnet bridge allowed (release builds block it by default on API 28+).
// Same applicationId and debug keystore, so an RC installs over the dev client in place.
const { withAndroidManifest } = require("expo/config-plugins");

function withCleartextTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
}

// DASH_APP_VARIANT=e2e: separate applicationId, name and URL scheme, so a native test build
// installs next to the live app (never over it) and pairs to the isolated test bridge.
const E2E_PACKAGE = "app.dash.mobile.e2e";

function withAppVariant(config) {
  if (process.env.DASH_APP_VARIANT !== "e2e") return config;
  return { ...config, name: "Dash E2E", scheme: "dash-e2e", android: { ...config.android, package: E2E_PACKAGE } };
}

// DASH_GLASS=1: Dash Glass, a side-by-side variant whose window shows the Android wallpaper
// behind a native glass layer (docs/design/GLASS-THEME.md). Own applicationId and scheme.
const GLASS_PACKAGE = "app.dash.mobile.glass";

function withGlass(config) {
  if (process.env.DASH_GLASS !== "1") return config;
  // Metro inlines EXPO_PUBLIC_* at transform time; set it for any bundler started from this process.
  process.env.EXPO_PUBLIC_DASH_GLASS = "1";
  return {
    ...config,
    name: "Dash Glass",
    scheme: "dash-glass",
    backgroundColor: "#00000000",
    ios: { ...config.ios, bundleIdentifier: GLASS_PACKAGE },
    android: { ...config.android, package: GLASS_PACKAGE },
    extra: { ...config.extra, dashGlass: true },
    plugins: [...(config.plugins ?? []), ["./plugins/withGlassWindow", { translucent: false }]],
  };
}

module.exports = ({ config: base }) => {
  const config = withGlass(withAppVariant(base));
  if (process.env.DASH_VARIANT !== "release") return config;
  const plugins = (config.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-dev-client");
  return withCleartextTraffic({ ...config, plugins });
};
