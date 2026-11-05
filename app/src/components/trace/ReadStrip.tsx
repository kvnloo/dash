import { DensityText as Text, DensityAnimatedText } from "../Density";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SNAP, fade, MOTION_MS } from "../../motion";
import { fonts, space, type } from "../../theme";
import { useDensity } from "../Density";
import { tc } from "./tokens";

export type ReadVariant = "slide" | "words" | "shimmer";

const spring = { ...SNAP, reduceMotion: ReduceMotion.System };

/** The interpretation strip. Numbers in the text render in tabular mono. */
export function ReadStrip({ text, variant = "slide", replay = 0 }: { text: string; variant?: ReadVariant; replay?: number }) {
  const reduced = useReducedMotion();
  const { sizing } = useDensity();
  const sentences = useMemo(() => text.split(/(?<=\.)\s+/).filter(Boolean), [text]);
  return (
    <View style={[styles.strip, { padding: sizing.padding, minWidth: 0, alignSelf: "stretch" }]} testID={`read-strip-${variant}`} accessibilityRole="summary" accessibilityLabel={`Read: ${text}`}>
      <Animated.View entering={reduced ? undefined : FadeIn.duration(fade.duration).reduceMotion(ReduceMotion.System)} style={styles.tagRow} key={`tag-${replay}`}>
        <Text style={styles.tag}>READ</Text>
      </Animated.View>
      {variant === "slide" ? <Slide key={replay} sentences={sentences} reduced={reduced} /> : null}
      {variant === "words" ? <Words key={replay} text={text} reduced={reduced} /> : null}
      {variant === "shimmer" ? <Shimmer key={replay} text={text} reduced={reduced} /> : null}
    </View>
  );
}

function Rich({ s }: { s: string }) {
  const parts = s.split(/(\d[\d:.,%×]*)/);
  return <>{parts.map((p, i) => (/^\d/.test(p) ? <Text key={i} style={styles.num}>{p}</Text> : p))}</>;
}

function Slide({ sentences, reduced }: { sentences: string[]; reduced: boolean }) {
  return (
    <View>
      {sentences.map((s, i) => (
        <DensityAnimatedText
          key={i}
          entering={reduced ? undefined : FadeInDown.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System)}
          style={styles.body}
        >
          <Rich s={s} />
        </DensityAnimatedText>
      ))}
    </View>
  );
}

function Word({ w, i }: { w: string; i: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(1, spring); }, [i, p]);
  const st = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 6 }] }));
  return <DensityAnimatedText style={[styles.body, st]}>{/^\d/.test(w) ? <Text style={styles.num}>{w}</Text> : w}{" "}</DensityAnimatedText>;
}

function Words({ text, reduced }: { text: string; reduced: boolean }) {
  if (reduced) return <Text style={styles.body}><Rich s={text} /></Text>;
  return <View style={styles.wrap}>{text.split(/\s+/).map((w, i) => <Word key={i} w={w} i={i} />)}</View>;
}

/** Known text is never hidden behind a simulated loading animation. */
function Shimmer({ text, reduced }: { text: string; reduced: boolean }) {
  return <DensityAnimatedText entering={reduced ? undefined : FadeIn.duration(fade.duration).reduceMotion(ReduceMotion.System)} style={styles.body}><Rich s={text} /></DensityAnimatedText>;
}

const styles = StyleSheet.create({
  strip: { paddingVertical: space.md, paddingHorizontal: space.lg, borderLeftWidth: 2, borderLeftColor: tc.ask, backgroundColor: "rgba(231,168,117,.05)", borderRadius: 4, gap: 4 },
  tagRow: { flexDirection: "row" },
  tag: { ...type.label, color: tc.ask, fontSize: 11, letterSpacing: 1.2 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: tc.text },
  num: { fontFamily: fonts.mono, fontSize: 14, color: tc.text, fontVariant: ["tabular-nums"] },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  loader: { overflow: "hidden", borderRadius: 4 },
  loading: { color: tc.text3 },
  band: { position: "absolute", top: 0, bottom: 0, width: 140 },
});
