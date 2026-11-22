import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { closePad } from "../../lib/dex";
import { sendPadEvent, type PadPoint } from "../../lib/dex-pad";

export function DashPad() {
  const [error, setError] = useState(false);
  const size = useRef({ width: 1, height: 1 });
  useEffect(() => () => sendPadEvent({ type: "reset" }), []);
  const contact = useMemo(() => {
    let points: PadPoint[] = [];
    let pinching = false;
    let previous: { center: PadPoint; distance: number } | undefined;
    let finger: number | undefined;
    type Contact = PadPoint & { id: number };
    const point = ({ x, y }: Contact) => ({
      x: Math.min(1, Math.max(0, x / size.current.width)),
      y: Math.min(1, Math.max(0, y / size.current.height)),
    });
    const pinch = (touches: readonly Contact[]) => {
      const [a, b] = touches;
      if (!a || !b) return;
      if (!pinching) sendPadEvent({ type: "cancel" });
      pinching = true;
      const pa = point(a), pb = point(b);
      const center = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (previous && previous.distance >= 4 && distance >= 4) {
        sendPadEvent({ type: "pinch", from: previous.center, to: center, scale: distance / previous.distance });
      }
      previous = { center, distance };
    };
    return Gesture.Manual().runOnJS(true)
      .onTouchesDown((e, manager) => {
        if (e.allTouches.length >= 2) { pinch(e.allTouches); return; }
        const touch = e.changedTouches[0];
        if (!touch || pinching) return;
        finger = touch.id;
        points = [point(touch)];
        manager.activate();
      })
      .onTouchesMove(e => {
        if (e.allTouches.length >= 2) { pinch(e.allTouches); return; }
        const touch = e.changedTouches.find(t => t.id === finger);
        if (!touch || pinching || points.length >= 2048) return;
        points = [...points, point(touch)];
        sendPadEvent({ type: "ink", points, done: false });
      })
      .onTouchesUp((e, manager) => {
        const remaining = e.allTouches.filter(t => !e.changedTouches.some(up => up.id === t.id));
        if (remaining.length < 2) previous = undefined;
        if (remaining.length) return;
        const touch = e.changedTouches.find(t => t.id === finger);
        if (!pinching && touch && points.length > 1) sendPadEvent({ type: "ink", points: [...points, point(touch)], done: true });
        manager.end();
      })
      .onTouchesCancelled((_e, manager) => manager.fail())
      .onFinalize(() => {
        pinching = false;
        previous = undefined;
        finger = undefined;
        points = [];
        sendPadEvent({ type: "cancel" });
      });
  }, []);
  return <GestureHandlerRootView style={styles.root}>
    <SafeAreaProvider><SafeAreaView testID="dex-pad" style={styles.pad}>
      <Text style={styles.title}>Dash Pad</Text>
      <Text style={styles.text}>Draw with one finger. Pinch with two to zoom the TV.</Text>
      <GestureDetector gesture={contact}>
        <View collapsable={false} testID="dex-pad-surface" accessibilityLabel="TV drawing surface" style={styles.surface}
          onLayout={e => { const { width, height } = e.nativeEvent.layout; size.current = { width: Math.max(width, 1), height: Math.max(height, 1) }; }} />
      </GestureDetector>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={() => sendPadEvent({ type: "reset" })} style={styles.button}><Text style={styles.text}>Reset zoom</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Touchpad" onPress={() => { void closePad().catch(() => setError(true)); }} style={styles.button}>
          <Text style={styles.text}>Close Dash Pad</Text>
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.text}>Could not close Dash Pad.</Text> : null}
    </SafeAreaView></SafeAreaProvider>
  </GestureHandlerRootView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  pad: { flex: 1, backgroundColor: "#000", padding: 16, gap: 12 },
  title: { color: "#fff", fontSize: 24 },
  text: { color: "#ddd" },
  surface: { flex: 1, minHeight: 44, backgroundColor: "#181818", borderColor: "#777", borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { borderWidth: 1, borderColor: "#777", padding: 14, borderRadius: 8 },
});
