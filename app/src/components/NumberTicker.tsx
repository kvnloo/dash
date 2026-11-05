import { useEffect } from "react";
import { StyleSheet, TextInput, type StyleProp, type TextStyle } from "react-native";
import { snappy } from "../motion";
import { useDensity } from "./Density";
import Animated, { ReduceMotion, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";

const Input = Animated.createAnimatedComponent(TextInput);

/** Animate native text directly, without React setState or a JS rAF per digit/frame. */
export function NumberTicker({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const n = useSharedValue(value);
  useEffect(() => { n.value = withTiming(value, { ...snappy, reduceMotion: ReduceMotion.System }); }, [n, value]);
  const props = useAnimatedProps(() => {
    const text = `${Math.round(n.value)}`;
    return { text, value: text };
  });
  const { typeScale } = useDensity();
  const flat = StyleSheet.flatten(style);
  return <Input editable={false} focusable={false} accessible={false} caretHidden underlineColorAndroid="transparent" pointerEvents="none" accessibilityLabel={String(value)} animatedProps={props} style={[{ padding: 0, borderWidth: 0 }, style, { fontSize: (flat?.fontSize ?? 26) * typeScale, lineHeight: (flat?.lineHeight ?? 32) * typeScale }]} />;
}
