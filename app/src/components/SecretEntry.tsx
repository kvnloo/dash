// Secure sudo entry (#560): full screen with the keyboard, no visible text field (only a row of
// masked dots), press-and-hold to reveal, and the exact command plus user@host the password is for.
// The typed text lives in this component's state only; it is sealed to the bridge's per-request key
// (lib/secret-seal.ts) and dropped. Nothing here logs it, stores it or sends it unsealed.
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { bridge } from "../net/bridge";
import { SealError, sealSecret } from "../lib/secret-seal";
import { dropSecretRequest, secretRequests } from "../store/secrets";
import { haptic } from "../haptics";
import { colors, radius, space, type } from "../theme";

const DOTS_SHOWN = 24;

export function SecretEntry(): React.JSX.Element | null {
  const request = secretRequests.use(s => s.open[0]);
  const last = secretRequests.use(s => s.last);
  const insets = useSafeAreaInsets();
  const input = useRef<TextInput>(null);
  const [text, setText] = useState("");
  const [reveal, setReveal] = useState(false);
  const [note, setNote] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const id = request?.id;
  useEffect(() => { setText(""); setReveal(false); setNote(""); setSentId(null); setNow(Date.now()); }, [id]);
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= request.expiresAt) { setText(""); dropSecretRequest(request.id); }
    }, 1000);
    return () => clearInterval(timer);
  }, [request]);
  if (!request) return null;
  const waiting = sentId === request.id;
  const left = Math.max(0, Math.ceil((request.expiresAt - now) / 1000));
  const submit = () => {
    if (waiting) return;
    try {
      const sealed = sealSecret(request, text);
      setText(""); setReveal(false);
      if (!bridge.send(sealed)) { setNote("Bridge offline. Reconnect and try again."); return; }
      haptic.success();
      setSentId(request.id);
      setNote("Sealed and sent. Waiting for sudo on the host…");
    } catch (error) {
      setNote(error instanceof SealError ? error.message : "Could not seal the password.");
    }
  };
  const decline = () => {
    setText(""); setReveal(false);
    bridge.send({ type: "secret_cancel", id: request.id });
    dropSecretRequest(request.id);
  };
  const shown = Math.min(text.length, DOTS_SHOWN);
  return (
    <Modal visible animationType="none" onRequestClose={decline} statusBarTranslucent>
      <View testID="secret-entry" accessibilityViewIsModal style={[styles.screen, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.md }]}>
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>sudo password</Text>
          <Text testID="secret-account" style={styles.account}>for {request.account}</Text>
          <Text style={styles.label}>The agent asked to run, once:</Text>
          <Text testID="secret-command" selectable style={styles.command}>$ sudo {request.command}</Text>
          {request.reason ? <Text style={styles.reason}>Reason given: {request.reason}</Text> : null}
          <Text style={styles.meta}>The password is sealed on this phone to the bridge and goes only into sudo. The agent sees the command's output, never the password. Expires in {left}s.</Text>
          <Pressable testID="secret-dots" accessibilityRole="button" accessibilityLabel={`Password, ${text.length} characters. Tap to type.`}
            onPress={() => input.current?.focus()} style={styles.dots}>
            <Text style={styles.dotText} numberOfLines={1}>
              {reveal ? text : shown ? "•".repeat(shown) + (text.length > DOTS_SHOWN ? "…" : "") : " "}
            </Text>
          </Pressable>
          <TextInput ref={input} testID="secret-input" accessibilityLabel="Password" value={text} onChangeText={setText}
            secureTextEntry autoFocus autoCorrect={false} autoCapitalize="none" spellCheck={false} autoComplete="off"
            importantForAutofill="no" textContentType="none" contextMenuHidden caretHidden maxLength={512}
            editable={!waiting} onSubmitEditing={submit} returnKeyType="go" style={styles.hidden} />
          <View style={styles.row}>
            <Pressable testID="secret-reveal" accessibilityRole="button" accessibilityLabel="Hold to reveal password"
              onPressIn={() => setReveal(true)} onPressOut={() => setReveal(false)} style={styles.chip}>
              <Text style={styles.chipText}>{reveal ? "◉ Showing" : "◎ Hold to reveal"}</Text>
            </Pressable>
          </View>
          {note ? <Text testID="secret-note" accessibilityRole="alert" style={styles.note}>{note}</Text> : null}
          {last && last.id !== request.id && last.outcome !== "delivered" && last.message ? <Text style={styles.meta}>Previous request: {last.message}</Text> : null}
        </ScrollView>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="Decline sudo request" onPress={decline} style={[styles.button, styles.secondary]}>
            <Text style={styles.chipText}>Decline</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Run with sudo" accessibilityState={{ disabled: waiting || !text }} disabled={waiting || !text}
            onPress={submit} style={[styles.button, styles.primary, (waiting || !text) && styles.disabled]}>
            <Text style={styles.primaryText}>{waiting ? "Waiting…" : "Run with sudo"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  body: { gap: space.sm, paddingBottom: space.lg },
  title: { ...type.title, color: colors.text },
  account: { ...type.mono, fontSize: 14, color: colors.gold },
  label: { ...type.small, color: colors.textMuted, marginTop: space.md },
  command: { ...type.mono, fontSize: 14, lineHeight: 20, color: colors.text, padding: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.hair },
  reason: { ...type.small, color: colors.textMuted },
  meta: { ...type.small, color: colors.textTertiary },
  dots: { minHeight: 64, justifyContent: "center", alignItems: "center", marginTop: space.lg, borderBottomWidth: 1, borderColor: colors.gold },
  dotText: { ...type.mono, fontSize: 28, lineHeight: 34, letterSpacing: 4, color: colors.text },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
  row: { flexDirection: "row", gap: space.sm, justifyContent: "center" },
  chip: { minHeight: 44, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.sm },
  chipText: { ...type.mono, color: colors.textMuted },
  note: { ...type.small, color: colors.textMuted, textAlign: "center" },
  button: { flex: 1, minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  secondary: { borderWidth: 1, borderColor: colors.hair },
  primary: { backgroundColor: colors.accent },
  primaryText: { ...type.heading, color: colors.bg },
  disabled: { opacity: 0.4 },
});
