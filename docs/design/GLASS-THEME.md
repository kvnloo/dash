# Glass theme (exploration spike)

Status: **spike**, branch `explore/glass-wallpaper`. Code only. No native build has run yet.

## What it does

Dash Glass is an opt-in personalization build. The Android wallpaper shows behind the app.
Live wallpapers show too (for example, the Samsung Infinity wallpaper). The system blurs the
wallpaper, and Dash paints one tint over it so text stays readable. The idea is the same as
Hyprland window transparency over a custom dotfiles theme.

- **Classic stays the default.** Without `DASH_GLASS=1`, `app.config.js` returns `app.json`
  unchanged. `expo config --type public` gives the same output as `dash-turbo`, and the
  generated `styles.xml` has no wallpaper items. All new JS paths are gated on the
  build-time `glassBuild` constant. In the classic build, `surfaces.scene === colors.bg` and
  `useGlassScene()` returns a constant.
- **Glass is a separate app.** It uses `applicationId app.dash.mobile.glass` and the label
  "Dash Glass", so it installs next to the live `app.dash.mobile` and never replaces it.
- **Inside the glass build**, Settings → Display → Theme offers **Classic | Glass**. The
  setting is persisted in AsyncStorage under `dash.glass.v1`, separate from bridge settings,
  so it works before pairing. Glass has the presets Clear / Frosted / Deep, plus − / + steppers
  for tint (5% steps) and blur (4dp steps). Classic mode inside the glass build paints today's
  opaque background and sets the window blur to 0.

## Pieces

| Piece | File |
|---|---|
| Variant switch (applicationId, name, plugin, `EXPO_PUBLIC_DASH_GLASS`) | `app/app.config.js` |
| Activity theme: `windowShowWallpaper`, transparent `windowBackground`, transparent bars, no forced bar contrast | `app/plugins/withGlassWindow.js` |
| Native window blur (Expo module `DashGlassWindow`) | `app/modules/dash-glass/` |
| JS API `setWindowGlass({ blurRadius, behindRadius })`, `glassWindowState()`, `onCrossWindowBlurChanged()` | `app/src/lib/glass-window{,.native}.ts` |
| Tokens, contrast math, presets, scene resolution (pure, unit-tested) | `app/src/lib/glass-theme.ts` |
| Persisted prefs + live blur availability | `app/src/store/glass.ts` |
| Keeps native blur in step with the scene and battery saver | `app/src/components/GlassWindow.tsx` |
| Settings UI | `app/src/components/GlassThemePicker.tsx` |
| `surfaces.scene` token, `glassBuild` flag | `app/src/theme.ts` |

### Layering (glass mode)

```
wallpaper window (live)              <- system, FLAG_SHOW_WALLPAPER
  window background blur (API 31+)   <- Window.setBackgroundBlurRadius(blur dp -> px)
  root view: rgba(bg, tint)          <- App.tsx, scene.root
  scene: transparent                 <- surfaces.scene on every screen root + nav contentStyle
  Canvas: scrim gradient only        <- header/dock text gets extra opacity
  GlassSurface panels                <- glass.fill tint; the opaque Android fallback becomes rgba(surfaceRaised,.72)
  Composer                           <- unchanged opaque ink-safe floor (composer-glass policy)
```

`behindRadius` (FLAG_BLUR_BEHIND + `setBlurBehindRadius`) is exposed but defaults to 0. On a
full-screen window, background blur and blur-behind cover the same pixels, so using both
only costs GPU time.

### Contrast

The tint is `colors.bg` (#0c0c0a). The math is in `glass-theme.ts` and uses WCAG relative
luminance with sRGB (gamma-space) compositing, which is how Android blends:

- `TINT_FLOOR` = 0.20. This is the lowest tint the UI allows. At this tint, body text
  (#ECE8DF) keeps 4.5:1 over a mid-grey (#808080) wallpaper, which is about the average of a
  blurred wallpaper. The Clear preset uses this value.
- `TINT_SAFE` = 0.62. At this tint, body text keeps 4.5:1 over a **pure white** wallpaper
  region. The Frosted default (0.65) is above it.
- When cross-window blur is off, the tint goes up by 0.12. With no blur, wallpaper detail is
  not softened.
- Canvas adds a top and bottom scrim of up to 0.25 extra, under header and dock text.

## API levels and caveats

- **Wallpaper behind the app** (`windowShowWallpaper`): all API levels.
- **Window blur**: API 31+ (Android 12) only. `Window.setBackgroundBlurRadius` and
  `LayoutParams.setBlurBehindRadius` are honoured only while
  `WindowManager.isCrossWindowBlurEnabled()` is true. Below API 31 the build uses tint only.
- **Samsung battery saver** (and AOSP power saver) turns cross-window blur **off**. So does
  Developer options → "Allow window-level blurs" (`disable_window_blurs`), and so does any
  GPU that cannot blur. The module registers `addCrossWindowBlurEnabledListener`, re-applies
  the blur, and emits `onCrossWindowBlurChanged`. JS then switches to the boosted tint while
  the app runs. On the owner's S25 (SDK 37), `disable_window_blurs` is unset, so blur is on.
- **`windowIsTranslucent` is off by default** (plugin option `translucent`). If you turn it
  on, the activity *below* Dash shows through too (the launcher icons when you start from
  home), and on API 26 a fixed `portrait` orientation crashes the activity. Background blur
  works without it, because the transparent window background makes the surface translucent.
  The module also calls `setFormat(TRANSLUCENT)`.
- **RN `Modal`s** open their own Dialog window. They stay opaque and do not show the
  wallpaper (Share sheet in `NativeEvents`, `ToolInspector`).
- **Deep links**: the scheme stays `dash` because in-app code builds and parses `dash://…`
  literally. With both apps installed, an external `dash://` link opens Android's app
  chooser. Push tokens are per app, so the glass app pairs and registers on its own.
- The `dash-glass` native module is in `app/modules/`, so autolinking also compiles it into
  the classic APK. There it is **inert**: nothing calls it, and the window is never touched.

## Performance risks

- A live wallpaper renders continuously in its own window. Real-time blur over it means the
  compositor re-blurs every frame. At 120Hz on the S25 this costs GPU time and battery while
  Dash is in the foreground, even when Dash itself is idle.
- Each blur radius step adds cost. `BLUR_MAX` is 60dp, and the native side clamps at 120dp.
  Presets stay between 16 and 40dp.
- In-app `expo-blur` (`GlassSurface blur`, composer dock) still samples app content on top
  of this. Two blur passes stack during scroll.
- The orb/bot animation perf work should measure these frame times on the S25 at 120Hz:
  Main + orb animating, with the Infinity live wallpaper, in four cases: (a) Classic, (b) Glass
  with blur 0, (c) Glass Frosted, (d) Glass Deep. Use `adb shell dumpsys gfxinfo
  app.dash.mobile.glass framestats` and Perfetto (SurfaceFlinger + GPU completion). If (c)
  misses the frame budget, cap the radius or drop it to 0 while the orb animates.

## Build and install the glass variant (when groot is free)

Do not run this while groot is busy or low on memory. Check `free -m` first.

```bash
cd /mnt/zer0models/z0-wt/dash-glass/app      # worktree; node_modules is a symlink to dash-turbo's
export DASH_GLASS=1 EXPO_PUBLIC_DASH_GLASS=1  # both: config variant + JS inlining in the bundle

# 1. Prebuild (idempotent; android/ is generated and not committed)
npx expo prebuild --platform android --clean --no-install

# 2. Verify the variant before building
grep -n windowShowWallpaper android/app/src/main/res/values/styles.xml
grep -n "applicationId 'app.dash.mobile.glass'" android/app/build.gradle

# 3. Build: debug (dev client, Metro) or a standalone release-style APK
cd android
./gradlew :app:assembleDebug   -PreactNativeArchitectures=arm64-v8a --no-daemon
#   or: ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
cd ..

# 4. Install next to the live app (different applicationId; the live app is untouched)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
#   Metro for the debug build (must also carry EXPO_PUBLIC_DASH_GLASS=1):
#   DASH_GLASS=1 EXPO_PUBLIC_DASH_GLASS=1 npx expo start --dev-client --port 8090
```

Native unit test (pure radius plan): `./gradlew :dash-glass:testDebugUnitTest` (`GlassRadiiTest`).

On-device checklist: the wallpaper shows and stays live behind Main; blur changes with the
presets; with battery saver on, blur stops and the tint goes up while the app runs (and back
when saver is off); the Chat window over Main hides Main; body text is readable over a white
wallpaper on Frosted; the Classic choice inside Dash Glass looks like the live app; and the
live `app.dash.mobile` is still installed and unchanged.

## Background references: changed vs left alone

There are about 58 opaque `backgroundColor` references in `app/src`. Only full-screen scene
backgrounds changed. Popovers, cards, controls, and content blocks that must occlude what is
under them stayed as they were.

**Changed (route through tokens / scene):**

- `App.tsx`: root view (`scene.root`), splash, navigator `contentStyle` (`surfaces.scene`),
  NavigationContainer `theme.colors.background`
- Screen roots → `surfaces.scene`: Main, Chat, Settings, Pair, Approvals, Notices,
  OrchestraDetail, Voice, LegacyVoice, Trace, Lab, ArtifactStage (12)
- `ChatScreen` window presentation (transparentModal over Main) → `scene.window`
  (≥ 0.94 tint, so it still hides Main)
- `Canvas` (the opaque top wash on 9 screens) → scrim-only gradient in glass mode
- `GlassSurface` opaque Android fallback (`colors.surfaceRaised`) → `scene.panelFallback`

**Left alone (opaque on purpose, or a separate window):**

- Composer and its dock (`composer-glass` policy: ink-safe opaque floor), `Composer` /
  `ComposerPrimaryAction` stop squares, `ComposerSuggestions`, `ComposerActionMenu`
- Popovers and cards over content: `ContextCard`, `QueuedStack`, `HarnessPicker`,
  `TargetSwitcherBadge`, `PromptRail`, `InteractiveTile`, `ServedBuildChip`, `Markdown`
  (code and input), `ReplyBlocks`, `LiveArtifactFrame`
- Modals (their own Dialog windows): `NativeEvents` share sheet, `ToolInspector`,
  `genui/InlineImage` full-screen viewer
- `ContinuousVoiceRoot` voice bar (an opaque band that covers scrolled content; candidate
  for `scene.window` later)
- Trace palette (`tc.*`), `TraceDetail` scrim, `IntentionalOrchestra`, `GelNav`,
  `HarnessVisualCore`, `AnnotationRoot` thumbnails, `InformationDensityPicker` and Density
  chips, `vendor/ripple`, `genui/mobile-preview`, `bootstrap.web`

## Open items

1. Native build plus the on-device checks above. The Kotlin has only been reviewed by eye,
   not compiled.
2. Perf measurement (see above). Decide on a radius cap and whether to drop blur while the
   orb animates.
3. Whether the voice bar and the popovers should take a translucent `scene.window` fill.
4. A real slider (no slider dependency is installed yet; steppers are used for now).
