import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { bedtimeSchedule, setBedtimeSchedule, validTime } from "../store/bedtime";
import { colors, space, type } from "../theme";
import { PressScale } from "./PressScale";

export function BedtimeSettings() {
  const schedule = bedtimeSchedule.use(s => s);
  const [bedtime, setBedtime] = useState<string>();
  const [wake, setWake] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!schedule) return null;
  const bed = bedtime ?? schedule.bedtime;
  const morning = wake ?? schedule.wake;
  const save = async (enabled: boolean, applyEdits: boolean) => {
    const nextBed = applyEdits ? bed : schedule.bedtime;
    const nextWake = applyEdits ? morning : schedule.wake;
    if (!validTime(nextBed) || !validTime(nextWake) || nextBed === nextWake) {
      setError("Enter two different times in 24-hour HH:MM format.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setBedtimeSchedule({ enabled, bedtime: nextBed, wake: nextWake });
      if (applyEdits) { setBedtime(undefined); setWake(undefined); }
    } catch { setError("Couldn't save the bedtime schedule."); }
    finally { setBusy(false); }
  };
  return <View style={styles.block}>
    <Text style={styles.body}>Bedtime capture</Text>
    <Text style={styles.note}>Save text on this device instead of sending between bedtime and wake time. Uses your device clock; saved thoughts never send automatically.</Text>
    <PressScale accessibilityRole="switch" accessibilityLabel="Bedtime capture only" accessibilityState={{ checked: schedule.enabled }} aria-checked={schedule.enabled} disabled={busy} onPress={() => void save(!schedule.enabled, false)} style={styles.hit}>
      <Text style={styles.action}>{schedule.enabled ? "On" : "Off"} · {schedule.bedtime}–{schedule.wake}</Text>
    </PressScale>
    <View style={styles.row}>
      <View><Text style={styles.note}>Bedtime (HH:MM)</Text><TextInput accessibilityLabel="Bedtime (HH:MM)" style={styles.input} value={bed} onChangeText={setBedtime} maxLength={5} /></View>
      <View><Text style={styles.note}>Wake time (HH:MM)</Text><TextInput accessibilityLabel="Wake time (HH:MM)" style={styles.input} value={morning} onChangeText={setWake} maxLength={5} /></View>
    </View>
    <PressScale accessibilityRole="button" disabled={busy || (bed === schedule.bedtime && morning === schedule.wake)} onPress={() => void save(schedule.enabled, true)} style={styles.hit}>
      <Text style={styles.action}>Save schedule</Text>
    </PressScale>
    {error ? <Text accessibilityRole="alert" style={styles.note}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  block: { paddingVertical: space.md, gap: space.sm },
  body: { ...type.body, color: colors.text },
  note: { ...type.small, color: colors.textMuted },
  action: { ...type.body, color: colors.gold },
  row: { flexDirection: "row", gap: space.md },
  hit: { minHeight: 44, justifyContent: "center" },
  input: { minHeight: 44, minWidth: 110, padding: space.sm, color: colors.text, borderColor: colors.hair, borderWidth: 1 },
});
