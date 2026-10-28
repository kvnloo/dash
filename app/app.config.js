// Build variants on top of app.json.
//   default (dev client): app.json unchanged.
//   DASH_VARIANT=release (RC): no expo-dev-client, embedded JS bundle, cleartext ws:// to
//   the tailnet bridge allowed (release builds block it by default on API 28+).
// Same applicationId and debug keystore, so an RC installs over the dev client in place.
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest } = require("expo/config-plugins");

// Live preview: the follower (scripts/channels/dash-channel) writes {sha, builtAtMs} into
// src/lib/build-info.json of an immutable release. Republish it in the manifest so a running app
// can compare the build it runs (baked into its bundle) with the build its Metro serves now.
function withBuildInfo(config) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "lib", "build-info.json"), "utf8"));
    if (info && typeof info.sha === "string" && info.sha !== "") {
      return { ...config, extra: { ...(config.extra ?? {}), dashBuild: { sha: info.sha, builtAtMs: info.builtAtMs ?? null } } };
    }
  } catch {
    // No build info (local checkout): the manifest simply carries none.
  }
  return config;
}

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

module.exports = ({ config: base }) => {
  const config = withBuildInfo(withAppVariant(base));
  if (process.env.DASH_VARIANT !== "release") return config;
  const plugins = (config.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-dev-client");
  return withCleartextTraffic({ ...config, plugins });
};
