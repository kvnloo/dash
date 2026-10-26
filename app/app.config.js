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

module.exports = ({ config }) => {
  if (process.env.DASH_VARIANT !== "release") return config;
  const plugins = (config.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-dev-client");
  return withCleartextTraffic({ ...config, plugins });
};
