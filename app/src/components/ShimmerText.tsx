import { memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, PixelRatio, Platform, Text, View, type TextStyle } from "react-native";
import { Canvas, LinearGradient, Text as SkText, matchFont, vec } from "@shopify/react-native-skia";
import { cancelAnimation, Easing, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import { SHIMMER_END, SHIMMER_REST_MS, SHIMMER_START, SHIMMER_SWEEP_MS, shimmerStops } from "../lib/activity-shimmer";
import { colors } from "../theme";
import { useAmbientRunning } from "./OrbMotion";

/** One native subscription for every visible shimmer. No row-per-listener overhead. */
const appSubscribers = new Set<() => void>();
let appListener: { remove(): void } | null = null;
let appActive = AppState.currentState === "active";

function appIsActive(): boolean {
  return appActive;
}

function subscribeAppActive(onChange: () => void): () => void {
  appSubscribers.add(onChange);
  if (!appListener) {
    // Synchronize across intervals when no shimmer was mounted.
    const nowActive = AppState.currentState === "active";
    if (nowActive !== appActive) {
      appActive = nowActive;
      for (const listener of appSubscribers) listener();
    }
    appListener = AppState.addEventListener("change", state => {
      const next = state === "active";
      if (next === appActive) return;
      appActive = next;
      for (const listener of appSubscribers) listener();
    });
  }
  return () => {
    appSubscribers.delete(onChange);
    if (appSubscribers.size === 0) {
      appListener?.remove();
      appListener = null;
    }
  };
}

/**
 * Actual text-paint shimmer, not a bright overlay sliding behind static text.
 * Skia paints the glyphs through a dim/bright/dim shader. Its UI-thread sweep
 * cancels when the screen blurs, the app backgrounds, motion is reduced or this
 * row unmounts. Reduced motion/web render the complete, bright, static label.
 */
export const ShimmerText = memo(function ShimmerText({
  text, size = 11, family = "monospace", dim = colors.textTertiary, bright = colors.text, style,
}: {
  text: string; size?: number; family?: string; dim?: string; bright?: string; style?: TextStyle;
}) {
  const reduced = useReducedMotion();
  const screenActive = useAmbientRunning();
  const foreground = useSyncExternalStore(subscribeAppActive, appIsActive, appIsActive);
  const running = screenActive && foreground;
  const [max, setMax] = useState(0);
  // Skia does not apply the font scale that React Native Text applies.
  const px = size * PixelRatio.getFontScale();
  const font = useMemo(() => Platform.OS === "web" ? null : matchFont({ fontFamily: family, fontSize: px }), [family, px]);
  const shown = useMemo(() => {
    if (!font || max <= 0 || font.getTextWidth(text) <= max) return text;
    // Slice by Unicode code point, never through the middle of a surrogate pair.
    const glyphs = Array.from(text);
    const ellipsis = "…";
    if (font.getTextWidth(ellipsis) >= max) return ellipsis;
    let lo = 0;
    let hi = glyphs.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const candidate = glyphs.slice(0, mid).join("") + ellipsis;
      if (font.getTextWidth(candidate) <= max) lo = mid;
      else hi = mid - 1;
    }
    return glyphs.slice(0, lo).join("") + ellipsis;
  }, [font, max, text]);
  const width = font ? Math.max(1, Math.ceil(font.getTextWidth(shown))) : 1;
  const height = Math.ceil(px * 1.5);
  const hasText = text.length > 0;
  const progress = useSharedValue(SHIMMER_START);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = SHIMMER_START;
    if (!running || !font || !hasText) return;
    progress.value = withRepeat(withDelay(SHIMMER_REST_MS, withTiming(SHIMMER_END, {
      duration: SHIMMER_SWEEP_MS, easing: Easing.linear,
    })), -1, false);
    return () => cancelAnimation(progress);
  }, [progress, running, font, hasText]);

  const positions = useDerivedValue(() => shimmerStops(progress.value));

  if (!font || reduced || !running) {
    return <View style={{ flexShrink: 1, minWidth: 0 }}>
      <Text numberOfLines={1} accessibilityRole="text" style={[{ fontSize: size, color: bright, fontFamily: family }, style]}>{text}</Text>
    </View>;
  }

  return (
    <View style={{ flex: 1, minWidth: 0, height }} onLayout={event => setMax(event.nativeEvent.layout.width)}
      accessible accessibilityRole="text" accessibilityLabel={text}>
      {max > 0 && hasText ? <Canvas style={{ width, height }}>
        <SkText x={0} y={Math.round(px * 1.15)} text={shown} font={font}>
          <LinearGradient start={vec(0, 0)} end={vec(width, 0)}
            colors={[dim, dim, bright, dim, dim]} positions={positions} />
        </SkText>
      </Canvas> : <Text numberOfLines={1} style={{ fontSize: size, fontFamily: family, color: dim }}>{text}</Text>}
    </View>
  );
});
