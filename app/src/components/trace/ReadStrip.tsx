import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SNAP } from "../../motion";
import { fonts, space, type } from "../../theme";
import { tc } from "./tokens";

export type ReadVariant = "slide" | "words" | "shimmer";

const spring = { ...SNAP, reduceMotion: ReduceMotion.System };

/** The interpretation strip. Numbers in the text render in tabular mono. */
export function ReadStrip({ text, variant = "slide", replay = 0 }: { text: string; variant?: ReadVariant; replay?: number }) {
  const reduced = useReducedMotion();
  const sentences = useMemo(() => text.split(/(?<=\.)\s+/).filter(Boolean), [text]);
  return (
    <View style={styles.strip} testID={`read-strip-${variant}`} accessibilityRole="summary" accessibilityLabel={`Read: ${text}`}>
      <Animated.View entering={reduced ? undefined : FadeIn.duration(180)} style={styles.tagRow} key={`tag-${replay}`}>
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
        <Animated.Text
          key={i}
          entering={reduced ? undefined : FadeInDown.delay(80 + i * 90).springify().mass(SNAP.mass).stiffness(SNAP.stiffness).damping(SNAP.damping)}
          style={styles.body}
        >
          <Rich s={s} />
        </Animated.Text>
      ))}
    </View>
  );
}

function Word({ w, i }: { w: string; i: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(60 + i * 28, withSpring(1, spring)); }, [i, p]);
  const st = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 6 }] }));
  return <Animated.Text style={[styles.body, st]}>{/^\d/.test(w) ? <Text style={styles.num}>{w}</Text> : w}{" "}</Animated.Text>;
}

function Words({ text, reduced }: { text: string; reduced: boolean }) {
  if (reduced) return <Text style={styles.body}><Rich s={text} /></Text>;
  return <View style={styles.wrap}>{text.split(/\s+/).map((w, i) => <Word key={i} w={w} i={i} />)}</View>;
}

/** Thinking-loader style: a shimmer band sweeps a placeholder, then the text settles up into place. */
function Shimmer({ text, reduced }: { text: string; reduced: boolean }) {
  const [done, setDone] = useState(reduced);
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    sweep.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, false);
    const t = setTimeout(() => setDone(true), 1300);
    return () => { clearTimeout(t); cancelAnimation(sweep); };
  }, [reduced, sweep]);
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -140 + sweep.value * 520 }] }));
  if (done) {
    return (
      <Animated.Text entering={reduced ? undefined : FadeInDown.springify().mass(SNAP.mass).stiffness(SNAP.stiffness).damping(SNAP.damping)} style={styles.body}>
        <Rich s={text} />
      </Animated.Text>
    );
  }
  return (
    <View style={styles.loader} testID="read-shimmer">
      <Text style={[styles.body, styles.loading]}>Reading the last 12 hours…</Text>
      <Animated.View style={[styles.band, band]} pointerEvents="none">
        <LinearGradient colors={["rgba(12,12,10,0)", "rgba(236,232,223,.18)", "rgba(12,12,10,0)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
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
