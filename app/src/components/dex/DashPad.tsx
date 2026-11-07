import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { closePad } from "../../lib/dex";

/** WP2 placeholder only: no second voice root, stylus listener or navigator. */
export function DashPad() {
  const [error, setError] = useState(false);
  return <View testID="dex-pad" style={styles.pad}>
    <Text style={styles.title}>Dash Pad</Text>
    <Text style={styles.text}>Mirror and annotation controls are not connected yet.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Touchpad" onPress={() => { void closePad().catch(() => setError(true)); }} style={styles.button}>
      <Text style={styles.text}>Touchpad</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={styles.text}>Could not close the Pad.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ pad: { flex: 1, backgroundColor: "#000", padding: 24, justifyContent: "center", gap: 16 }, title: { color: "#fff", fontSize: 24 }, text: { color: "#ccc" }, button: { borderWidth: 1, borderColor: "#777", padding: 16, alignSelf: "flex-start" } });
