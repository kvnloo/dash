---
name: dash-android-ui
description: Android/Expo UI for Dash on the S25. Use when changing phone screens, composers, nav, keyboard, safe area, or Expo Go layout.
---

# Dash Android UI

The phone is an S25 Ultra on **Android 15 edge-to-edge**, running **Expo Go** (`host.exp.exponent`). The window does **not** resize for the IME. `app.json` `softwareKeyboardLayoutMode: "resize"` is ignored by Expo Go.

## Keyboard (do this without being asked)

Any bottom input (Main `GlobalSearchBar`, Chat `Composer`) must sit in `KeyboardDock` (`KeyboardStickyView` from `react-native-keyboard-controller`).

- `KeyboardProvider` in `App.tsx` must be `statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge`.
- Do not park a composer with `paddingBottom: insets.bottom` and assume the IME will lift it.
- Do not use React Native's `KeyboardAvoidingView`. Settings may use Keyboard Controller's `KeyboardAvoidingView` for in-scroll fields.
- A screenshot where the IME covers "Message Dash" is a fail.

## Native chrome

Nav is native `AppNav` at **60px**. No gold glow overlay, no 80px spacer, no WebView nav. The down chevron + a top pan pull a GEL `BridgePull` sheet (not Settings). Settings is Edit on that sheet. Drive with **Maestro**, not hand-rolled `adb` dumps. Do not `launchApp` with `stopApp` (kills Metro).

## Expo

Stay on Expo Go unless a native module is actually missing from the host. Reload the live Metro on **8097**; never start a second bundler.

Official Expo/Android skills live in `~/.cursor/skills/` (`building-native-ui`, `expo-dev-client`, `android-emulator-qa`, `android-performance`).

Motion: `dash-motion`. Reanimated 4 + `PressScale` + `app/src/motion.ts`. No FlashList entering animations. No gold glow overlay.
