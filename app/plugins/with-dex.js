const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withDex(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) throw new Error("DeX requires an Android application");
    app.$["android:resizeableActivity"] = "true";
    app["meta-data"] ??= [];
    // Samsung DeX: keep the process alive when the window moves between the phone and the
    // external display, and across the DeX density switch instead of a restart (Samsung DeX
    // "App optimization" guide); the legacy multiwindow flag lets One UI offer a resizable window.
    const samsung = {
      "com.samsung.android.multidisplay.keep_process_alive": "true",
      "com.samsung.android.keepalive.density": "true",
      "com.sec.android.support.multiwindow": "true",
    };
    app["meta-data"] = app["meta-data"].filter(item => !(item.$["android:name"] in samsung));
    for (const [name, value] of Object.entries(samsung)) app["meta-data"].push({ $: { "android:name": name, "android:value": value } });
    for (const activity of app.activity ?? []) {
      if (!activity.$["android:name"].endsWith("MainActivity")) continue;
      activity.$["android:resizeableActivity"] = "true";
      const changes = new Set((activity.$["android:configChanges"] ?? "").split("|").filter(Boolean));
      // A mouse/keyboard attaching in DeX must not restart the activity either.
      for (const value of ["smallestScreenSize", "screenLayout", "screenSize", "density", "uiMode", "orientation", "keyboard", "keyboardHidden", "navigation"]) changes.add(value);
      activity.$["android:configChanges"] = [...changes].join("|");
      // Freeform/DeX window: open desk-sized, never narrower than a phone.
      activity.layout = [{ $: { "android:defaultWidth": "1280dp", "android:defaultHeight": "800dp", "android:minWidth": "360dp", "android:minHeight": "480dp" } }];
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
