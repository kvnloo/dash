// Classic build: app.json passes through untouched (DASH_GLASS unset => identical config).
// Glass build (DASH_GLASS=1): a separate, side-by-side installable variant whose window shows the
// Android wallpaper behind a native glass layer. See docs/design/GLASS-THEME.md.
const GLASS_PACKAGE = "app.dash.mobile.glass";

module.exports = ({ config }) => {
  if (process.env.DASH_GLASS !== "1") return config;
  // Metro inlines EXPO_PUBLIC_* at transform time; set it for any bundler started from this
  // process. Build scripts should still export it explicitly (see GLASS-THEME.md).
  process.env.EXPO_PUBLIC_DASH_GLASS = "1";
  return {
    ...config,
    name: "Dash Glass",
    backgroundColor: "#00000000",
    ios: { ...config.ios, bundleIdentifier: GLASS_PACKAGE },
    android: { ...config.android, package: GLASS_PACKAGE },
    extra: { ...config.extra, dashGlass: true },
    plugins: [...(config.plugins ?? []), ["./plugins/withGlassWindow", { translucent: false }]],
  };
};
