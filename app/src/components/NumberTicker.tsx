import { useEffect } from "react";
import { StyleSheet, TextInput, type StyleProp, type TextStyle } from "react-native";
import { MOTION_MS } from "../motion";
import { useDensity } from "./Density";
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const Input = Animated.createAnimatedComponent(TextInput);

/** Animate native text directly, without React setState or a JS rAF per digit/frame. */
export function NumberTicker({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const n = useSharedValue(value);
  useEffect(() => { n.value = withTiming(value, { duration: reduced ? 0 : MOTION_MS.enter, easing: Easing.out(Easing.cubic) }); }, [n, reduced, value]);
  const props = useAnimatedProps(() => {
    const text = `${Math.round(n.value)}`;
    return { text, value: text };
  });
  const { typeScale } = useDensity();
  const flat = StyleSheet.flatten(style);
  return <Input editable={false} focusable={false} accessible={false} caretHidden underlineColorAndroid="transparent" pointerEvents="none" accessibilityLabel={String(value)} animatedProps={props} style={[{ padding: 0, borderWidth: 0 }, style, { fontSize: (flat?.fontSize ?? 26) * typeScale, lineHeight: (flat?.lineHeight ?? 32) * typeScale }]} />;
}
