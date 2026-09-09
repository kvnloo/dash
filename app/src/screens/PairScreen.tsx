import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppNav } from "../components/AppNav";
import { GlassSurface } from "../components/GlassSurface";
import { haptic } from "../haptics";
import { newClaimKey } from "../lib/pair-crypto";
import { claimLivePair, claimPairCode, hearPairTones, settingsFromClaim, startSonicPair } from "../lib/pair-api";
import type { ScreenProps } from "../navigation";
import { bridge } from "../net/bridge";
import { saveSettings, store } from "../store/app";
import { colors, radius, space, type } from "../theme";

const RECORD_MS = 6500;

export function PairScreen({ navigation }: ScreenProps<"Pair">) {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [computer, setComputer] = useState("100.78.215.21");
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimKeyRef = useRef<Uint8Array | null>(null);

  const ensureClaimKey = useCallback((): Uint8Array => {
    claimKeyRef.current ??= newClaimKey();
    return claimKeyRef.current;
  }, []);

  const finishClaim = useCallback(
    async (code: string, claimKey?: Uint8Array) => {
      setError(null);
      setStatus("Finishing secure pairing…");
      const claim = await claimPairCode(computer, code, claimKey);
      await connectClaim(claim);
    },
    [computer, navigation],
  );

  const connectClaim = useCallback(
    async (claim: Awaited<ReturnType<typeof claimPairCode>>) => {
      const settings = settingsFromClaim(claim);
      saveSettings(settings);
      bridge.start(settings);
      const online = await waitForOnline(8000);
      if (!online) throw new Error("Paired but bridge WebSocket did not connect");
      haptic.success();
      claimKeyRef.current = null;
      navigation.replace("Main");
    },
    [navigation],
  );

  const pairWithSound = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus("Requesting microphone…");
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) throw new Error("Microphone permission is required to hear the pairing tones");

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const claimKey = ensureClaimKey();
      await recorder.prepareToRecordAsync();
      recorder.record();
      for (let i = 0; i < 25 && !recorder.getStatus().isRecording; i++) await sleep(40);
      if (!recorder.getStatus().isRecording) throw new Error("Microphone did not start recording");

      setStatus("Listening… hold the phone by the laptop speakers");
      const playing = startSonicPair(computer, claimKey);
      await sleep(RECORD_MS);
      await recorder.stop();
      await playing;

      const uri = recorder.uri;
      if (!uri) throw new Error("Recording failed");
      setStatus("Decoding pairing tones…");
      const bytes = new Uint8Array(await new File(uri).arrayBuffer());
      const mime = uri.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/m4a";
      const claim = await hearPairTones(computer, claimKey, bytes, mime);
      await connectClaim(claim);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
      try {
        if (recorder.getStatus().isRecording) await recorder.stop();
      } catch {
        /* already stopped */
      }
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, computer, connectClaim, ensureClaimKey, recorder]);

  const pairOverTailscale = useCallback(async () => {
    if (busy || computer.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(`Connecting to ${computer.trim()}…`);
      const claim = await claimLivePair(computer);
      await connectClaim(claim);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, computer, connectClaim]);

  const pairWithCode = useCallback(async () => {
    if (busy || manualCode.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await finishClaim(manualCode.trim());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, finishClaim, manualCode]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <AppNav navigation={navigation} tab={1} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Pair with your laptop</Text>
        <Text style={styles.intro}>
          Same Tailscale tailnet as this phone. Computer is the MagicDNS name or Tailscale IP (port 4747).
        </Text>

        <GlassSurface variant="raised" borderRadius={radius.md} style={styles.inputWrap}>
          <TextInput
            value={computer}
            onChangeText={setComputer}
            placeholder="100.78.215.21"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            style={styles.inputInner}
          />
        </GlassSurface>
        <Text style={styles.hint}>This laptop is 100.78.215.21 — Pair over Tailscale skips the speaker tones.</Text>

        <Pressable
          onPress={() => void pairOverTailscale()}
          disabled={busy || computer.trim().length === 0}
          style={({ pressed }) => [styles.primary, (busy || computer.trim().length === 0) && styles.primaryDisabled, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>Pair over Tailscale</Text>}
        </Pressable>

        <Pressable
          onPress={() => void pairWithSound()}
          disabled={busy || computer.trim().length === 0}
          style={({ pressed }) => [styles.secondary, (busy || computer.trim().length === 0) && styles.secondaryDisabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Listen for pairing sound</Text>
        </Pressable>

        {status ? <Text style={styles.status}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GlassSurface variant="raised" borderRadius={radius.md} style={styles.inputWrap}>
          <TextInput
            value={manualCode}
            onChangeText={(t) => setManualCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder="ABC123"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.inputInner, styles.codeInput]}
          />
        </GlassSurface>
        <Pressable
          onPress={() => void pairWithCode()}
          disabled={busy || manualCode.length !== 6}
          style={({ pressed }) => [styles.secondary, (busy || manualCode.length !== 6) && styles.secondaryDisabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Pair with code</Text>
        </Pressable>

        <Pressable onPress={() => navigation.navigate("Settings", { firstRun: true })} style={styles.linkWrap}>
          <Text style={styles.link}>Enter address and token manually</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOnline(timeoutMs: number): Promise<boolean> {
  if (store.get().connection.status === "online") return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (store.get().connection.status === "online") return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg },
  title: { color: colors.text, ...type.title, marginBottom: space.sm },
  intro: { color: colors.textMuted, ...type.body, marginBottom: space.xl },
  hint: { color: colors.textFaint, ...type.small, marginTop: space.xs, marginBottom: space.lg },
  inputWrap: { marginBottom: space.sm },
  inputInner: {
    color: colors.text,
    ...type.body,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
  },
  codeInput: { ...type.mono, letterSpacing: 4, textAlign: "center" },
  primary: {
    marginTop: space.md,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  primaryDisabled: { backgroundColor: colors.surfaceRaised },
  primaryText: { color: colors.onAccent, ...type.heading },
  secondary: {
    marginTop: space.sm,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  secondaryDisabled: { opacity: 0.45 },
  secondaryText: { color: colors.text, ...type.body },
  status: { color: colors.textMuted, ...type.small, marginTop: space.md, textAlign: "center" },
  error: { color: colors.danger, ...type.small, marginTop: space.md, textAlign: "center" },
  linkWrap: { marginTop: space.xxl, alignItems: "center" },
  link: { color: colors.textMuted, ...type.body, textDecorationLine: "underline" },
  pressed: { opacity: 0.75 },
});
