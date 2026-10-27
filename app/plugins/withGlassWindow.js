// Dash Glass: let the Android wallpaper (live wallpapers included) show through the app window.
// Applied only by app.config.js when DASH_GLASS=1; the classic build never loads this file.
const { AndroidConfig, withAndroidStyles } = require("expo/config-plugins");

const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles;

/**
 * Items written into AppTheme (res/values/styles.xml).
 * - windowShowWallpaper: WindowManager draws the wallpaper window behind ours (FLAG_SHOW_WALLPAPER).
 * - windowBackground transparent + no cache hint: nothing opaque is painted under React Native.
 * - transparent bars, no forced contrast scrim: edge-to-edge glass under status/nav bars.
 * Blur radii are applied at runtime by modules/dash-glass (they must follow battery saver live).
 */
function glassThemeItems({ translucent = false } = {}) {
  const items = [
    ["android:windowShowWallpaper", "true"],
    ["android:windowBackground", "@android:color/transparent"],
    ["android:colorBackgroundCacheHint", "@null"],
    ["android:statusBarColor", "@android:color/transparent"],
    ["android:navigationBarColor", "@android:color/transparent"],
    ["android:enforceStatusBarContrast", "false"],
    ["android:enforceNavigationBarContrast", "false"],
  ];
  // Off by default: a translucent activity also reveals the activity below it (the launcher's
  // icons when started from home) and, on API 26 only, crashes with a fixed portrait orientation.
  // windowShowWallpaper alone is enough for the wallpaper and the window blur on API 31+.
  if (translucent) items.push(["android:windowIsTranslucent", "true"]);
  return items;
}

function applyGlassTheme(styles, options) {
  let next = styles;
  for (const [name, value] of glassThemeItems(options)) {
    next = assignStylesValue(next, { add: true, parent: getAppThemeGroup(), name, value });
  }
  return next;
}

const withGlassWindow = (config, options = {}) =>
  withAndroidStyles(config, (mod) => {
    mod.modResults = applyGlassTheme(mod.modResults, options);
    return mod;
  });

module.exports = withGlassWindow;
module.exports.glassThemeItems = glassThemeItems;
module.exports.applyGlassTheme = applyGlassTheme;
