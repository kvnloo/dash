import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { closePad } from "../../lib/dex";
import { padAspect, sendPadEvent, subscribePadAspect, type PadPoint, type PadSample } from "../../lib/dex-pad";

type Contact = GestureResponderEvent["nativeEvent"];
type ContactId = Contact["identifier"];

export function DashPad() {
  const [error, setError] = useState(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const aspect = useSyncExternalStore(subscribePadAspect, padAspect);
  const width = Math.min(room.width, room.height * aspect);
  const height = width / aspect;
  const tracking = useRef<{ points: PadSample[]; finger: ContactId; pinching: boolean;
    previous?: { center: PadPoint; distance: number; first: ContactId; second: ContactId };
  }>(undefined);
  useEffect(() => () => sendPadEvent({ type: "reset" }), []);

  const point = (touch: Contact) => ({
    x: Math.min(1, Math.max(0, touch.locationX / Math.max(1, width))),
    y: Math.min(1, Math.max(0, touch.locationY / Math.max(1, height))),
  });
  const sample = (touch: Contact): PadSample => ({ ...point(touch), t: Date.now() });
  function pinch(touches: Contact[]) {
    const current = tracking.current;
    const [a, b] = touches;
    if (!current || !a || !b) return;
    if (!current.pinching) sendPadEvent({ type: "cancel" });
    current.pinching = true;
    const pa = point(a), pb = point(b);
    const center = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const distance = Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY);
    const previous = current.previous;
    if (previous && previous.first === a.identifier && previous.second === b.identifier && previous.distance >= 4 && distance >= 4) {
      sendPadEvent({ type: "pinch", from: previous.center, to: center, scale: distance / previous.distance });
    }
    current.previous = { center, distance, first: a.identifier, second: b.identifier };
  }
  const contacts = {
    onResponderStart: ({ nativeEvent: { touches, changedTouches } }: GestureResponderEvent) => {
      if (touches.length >= 2) { pinch(touches); return; }
      const touch = changedTouches[0];
      if (touch) tracking.current = { points: [sample(touch)], finger: touch.identifier, pinching: false };
    },
    onResponderEnd: ({ nativeEvent: { touches } }: GestureResponderEvent) => {
      if (tracking.current && touches.length < 2) tracking.current.previous = undefined;
    },
    onResponderMove: ({ nativeEvent: { touches, changedTouches } }: GestureResponderEvent) => {
      if (touches.length >= 2) { pinch(touches); return; }
      const current = tracking.current;
      if (!current || current.pinching || current.points.length >= 2048) return;
      const touch = changedTouches.find(t => t.identifier === current.finger);
      if (!touch) return;
      current.points.push(sample(touch));
      sendPadEvent({ type: "ink", points: current.points.slice(), done: false });
    },
    onResponderRelease: ({ nativeEvent: { changedTouches } }: GestureResponderEvent) => {
      const current = tracking.current;
      tracking.current = undefined;
      const touch = changedTouches.find(t => t.identifier === current?.finger);
      if (current && !current.pinching && touch && current.points.length > 1) {
        sendPadEvent({ type: "ink", points: [...current.points, sample(touch)], done: true });
      } else sendPadEvent({ type: "cancel" });
    },
    onResponderTerminate: () => {
      tracking.current = undefined;
      sendPadEvent({ type: "cancel" });
    },
  };
  return <SafeAreaProvider style={styles.root}><SafeAreaView testID="dex-pad" style={styles.pad}>
      <Text style={styles.title}>Dash Pad</Text>
      <Text style={styles.text}>Draw with one finger. Pinch with two to zoom the TV.</Text>
      <View style={styles.surfaceRoom} onLayout={e => setRoom(e.nativeEvent.layout)}>
        {width > 0 && height > 0 ? <View collapsable={false} testID="dex-pad-surface" accessibilityLabel="TV drawing surface"
          style={[styles.surface, { width, height }, Platform.OS === "web" && webSurface]}
          onStartShouldSetResponder={() => true} {...contacts} /> : null}
      </View>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={() => sendPadEvent({ type: "reset" })} style={styles.button}><Text style={styles.text}>Reset zoom</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Touchpad" onPress={() => { void closePad().catch(() => setError(true)); }} style={styles.button}>
          <Text style={styles.text}>Close Dash Pad</Text>
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.text}>Could not close Dash Pad.</Text> : null}
    </SafeAreaView></SafeAreaProvider>;
}
const webSurface = { touchAction: "none", userSelect: "none" } satisfies ViewStyle & { touchAction: "none"; userSelect: "none" };
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  pad: { flex: 1, backgroundColor: "#000", padding: 16, gap: 12 },
  title: { color: "#fff", fontSize: 24 },
  text: { color: "#ddd" },
  surfaceRoom: { flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center" },
  surface: { backgroundColor: "#181818", borderColor: "#777", borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { borderWidth: 1, borderColor: "#777", padding: 14, borderRadius: 8 },
});
