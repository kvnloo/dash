const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withDex(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) throw new Error("DeX requires an Android application");
    app.$["android:resizeableActivity"] = "true";
    app["meta-data"] ??= [];
    const name = "com.samsung.android.multidisplay.keep_process_alive";
    app["meta-data"] = app["meta-data"].filter(item => item.$["android:name"] !== name);
    app["meta-data"].push({ $: { "android:name": name, "android:value": "true" } });
    for (const activity of app.activity ?? []) {
      if (!activity.$["android:name"].endsWith("MainActivity")) continue;
      activity.$["android:resizeableActivity"] = "true";
      const changes = new Set((activity.$["android:configChanges"] ?? "").split("|").filter(Boolean));
      for (const value of ["smallestScreenSize", "screenLayout", "density", "uiMode", "orientation"]) changes.add(value);
      activity.$["android:configChanges"] = [...changes].join("|");
      // Portrait stays in app.json; DexLifecycle unlocks only the external window.
    }
    for (const feature of manifest["uses-feature"] ?? []) {
      delete feature.$["android:reqTouchScreen"];
      if (feature.$["android:name"] === "android.hardware.touchscreen") feature.$["android:required"] = "false";
    }
    for (const configuration of manifest["uses-configuration"] ?? []) delete configuration.$["android:reqTouchScreen"];
    return mod;
  });
};
