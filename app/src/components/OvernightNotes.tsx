import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { dismissCapture, overnightCaptures } from "../store/overnight-captures";
import { colors, space, type } from "../theme";
import { PressScale } from "./PressScale";

export function OvernightNotes({ conversationId, onUse }: { conversationId?: string; onUse(text: string): void }) {
  const queue = overnightCaptures.use(queue => queue);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const notes = queue.filter(item => item.conversationId === conversationId && item.status === "queued");
  if (!notes.length) return null;
  return <View style={styles.wrap}>
    <PressScale accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.hit} onPress={() => setOpen(v => !v)}>
      <Text style={styles.action}>Saved for tomorrow ({notes.length})</Text>
    </PressScale>
    {open ? <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
      {notes.map(note => <View key={note.id} style={styles.note}>
        <Text style={styles.body}>{note.text}</Text>
        <View style={styles.row}>
          <PressScale accessibilityRole="button" accessibilityLabel="Copy thought to draft" onPress={() => onUse(note.text)} style={styles.hit}>
            <Text style={styles.action}>Copy to draft</Text>
          </PressScale>
          <PressScale accessibilityRole="button" accessibilityLabel="Dismiss saved thought" onPress={() => {
            setError(false);
            void dismissCapture(note.id).catch(() => setError(true));
          }} style={styles.hit}><Text style={styles.action}>Dismiss</Text></PressScale>
        </View>
      </View>)}
      {error ? <Text accessibilityRole="alert" style={styles.body}>Couldn't dismiss the saved thought.</Text> : null}
    </ScrollView> : null}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.sm },
  list: { maxHeight: 150 },
  note: { borderTopWidth: 1, borderColor: colors.hair, paddingVertical: space.xs },
  row: { flexDirection: "row", gap: space.md },
  hit: { minHeight: 44, justifyContent: "center" },
  action: { ...type.small, color: colors.gold },
  body: { ...type.small, color: colors.text },
});
