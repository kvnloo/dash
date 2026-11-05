import { memo, useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform, Text, View, type TextStyle } from "react-native";
import { Canvas, LinearGradient, Text as SkText, matchFont, vec } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";

/**
 * Status text whose glyphs light up as a soft band of brightness sweeps left to right, as in ChatGPT's
 * "Thinking" and DeepSeek Harness's TextShimmer (packages/client/ui-primitives: the text itself is re-tinted
 * through a moving gradient mask, 1.5 s sweep then a short rest). Implemented as one Skia text draw with a
 * moving gradient shader, so the UI thread animates it and there is no overlay box.
 */
export const ShimmerText = memo(function ShimmerText({ text, size = 11, family = "monospace", dim = "#837F74", bright = "#F4F1EA", style }: {
  text: string; size?: number; family?: string; dim?: string; bright?: string; style?: TextStyle;
}) {
  const reduced = useReducedMotion();
  const [max, setMax] = useState(0);
  // Skia ignores the system font scale that RN Text applies (the owner runs 0.65), so apply it here.
  const px = size * PixelRatio.getFontScale();
  const font = useMemo(() => (Platform.OS === "web" ? null : matchFont({ fontFamily: family, fontSize: px })), [family, px]);
  const shown = useMemo(() => {
    if (!font || !max) return text;
    if (font.getTextWidth(text) <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (font.getTextWidth(text.slice(0, mid) + "…") <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo) + "…";
  }, [font, max, text]);
  const width = font ? Math.ceil(font.getTextWidth(shown)) : 0;
  const height = Math.ceil(px * 1.5);
  const p = useSharedValue(-0.3);
  useEffect(() => {
    if (reduced) return;
    p.value = -0.3;
    p.value = withRepeat(withDelay(300, withTiming(1.3, { duration: 1000, easing: Easing.linear })), -1);
  }, [p, reduced]);
  const positions = useDerivedValue(() => {
    const c = Math.min(1.3, Math.max(-0.3, p.value));
    const a = Math.min(1, Math.max(0, c - 0.22)), m = Math.min(1, Math.max(0, c)), b = Math.min(1, Math.max(0, c + 0.22));
    return [0, a, m, b, 1];
  });
  if (!font || reduced) {
    return <View style={{ flexShrink: 1, minWidth: 0 }}><Text numberOfLines={1} style={[{ fontSize: size, color: dim, fontFamily: family }, style]}>{text}</Text></View>;
  }
  return (
    <View style={{ flex: 1, minWidth: 0, height }} onLayout={e => setMax(e.nativeEvent.layout.width)} accessible accessibilityLabel={text}>
      {max ? <Canvas style={{ width, height }}>
        <SkText x={0} y={Math.round(px * 1.15)} text={shown} font={font}>
          <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={[dim, dim, bright, dim, dim]} positions={positions} />
        </SkText>
      </Canvas> : null}
    </View>
  );
});
