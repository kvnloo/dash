import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { runDeviceCheck, type DeviceCheckReport } from "../lib/device-check";
import { colors, radius, space, type } from "../theme";

/** Read-only diagnostic report; copying never sends information to any service. */
export function DeviceCheck(): React.JSX.Element {
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<DeviceCheckReport | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    void runDeviceCheck().then(result => {
      if (mounted) { setReport(result); setError(false); }
    }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, [revision]);

  const copy = async () => {
    if (!report) return;
    try {
      await Clipboard.setStringAsync(report.text);
      setCopied(true);
    } catch {
      setCopied(false);
      setError(true);
    }
  };

  return (
    <View style={styles.panel} testID="device-check">
      <Text style={styles.title}>Device self-check</Text>
      <Text style={styles.help}>Read-only. No permissions requested, credentials displayed or commands executed.</Text>
      {report ? (
        <Text testID="device-check-report" selectable style={styles.report}>{report.text}</Text>
      ) : <Text accessibilityLiveRegion="polite" style={styles.help}>{error ? "Device check unavailable" : "Checking device and bridge…"}</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Run device self-check again" style={styles.button} onPress={() => {
          setReport(null); setError(false); setCopied(false); setRevision(value => value + 1);
        }}>
          <Text style={styles.buttonText}>Check again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy report" disabled={!report} accessibilityState={{ disabled: !report }} style={[styles.button, !report && styles.disabled]} onPress={() => void copy()}>
          <Text style={styles.buttonText}>Copy report</Text>
        </Pressable>
      </View>
      {copied ? <Text accessibilityLiveRegion="polite" style={styles.help}>Report copied</Text> : null}
      {error && report ? <Text accessibilityRole="alert" style={styles.help}>Copy failed. Try again.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.lg, marginTop: space.sm, gap: space.sm },
  title: { ...type.heading, color: colors.text },
  help: { ...type.small, color: colors.textMuted },
  report: { ...type.mono, fontSize: 12, lineHeight: 19, color: colors.text },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  button: { minHeight: 44, minWidth: 112, justifyContent: "center", alignItems: "center", borderRadius: radius.sm, paddingHorizontal: space.md, borderColor: colors.border, borderWidth: 1 },
  disabled: { opacity: 0.5 },
  buttonText: { ...type.small, color: colors.text },
});
