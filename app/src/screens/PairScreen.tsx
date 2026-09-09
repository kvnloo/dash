import { Audio } from "expo-av";
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
import { haptic } from "../haptics";
import { newClaimKey } from "../lib/pair-crypto";
import { claimPairCode, settingsFromClaim, startSonicPair } from "../lib/pair-api";
import { decodePairCodeFromWav } from "../lib/sonic-pair";
import type { ScreenProps } from "../navigation";
import { bridge } from "../net/bridge";
import { saveSettings, store } from "../store/app";
import { colors, radius, space, type } from "../theme";

const RECORD_MS = 4500;

export function PairScreen({ navigation }: ScreenProps<"Pair">) {
  const insets = useSafeAreaInsets();
  const [computer, setComputer] = useState("mbp");
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
      const settings = settingsFromClaim(claim);
      saveSettings(settings);
      bridge.start(settings);
      const online = await waitForOnline(8000);
      if (!online) throw new Error("Paired but bridge WebSocket did not connect");
      haptic.success();
      claimKeyRef.current = null;
      navigation.replace("Chat");
    },
    [computer, navigation],
  );

  const pairWithSound = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus("Requesting mic…");
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error("Microphone permission is required for sonic pairing");

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const claimKey = ensureClaimKey();
      setStatus("Starting secure pairing…");
      await startSonicPair(computer, claimKey);

      setStatus("Hold your phone near the laptop speakers…");
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        isMeteringEnabled: false,
        android: {
          extension: ".wav",
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 44100,
          numberOfChannels: 1,
        },
        ios: {
          extension: ".wav",
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
          bitRate: 128000,
        },
        web: {},
      });
      await recording.startAsync();
      await sleep(RECORD_MS);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error("Recording failed");

      setStatus("Decoding pairing tones…");
      const file = new File(uri);
      const bytes = await file.bytes();
      const code = decodePairCodeFromWav(bytes);
      if (!code) throw new Error("Could not hear the pairing code — try again closer to the speakers");
      await finishClaim(code, claimKey);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, computer, ensureClaimKey, finishClaim]);

  const pairWithCode = useCallback(async () => {
    if (busy || manualCode.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const claimKey = ensureClaimKey();
      await startSonicPair(computer, claimKey);
      await finishClaim(manualCode.trim(), claimKey);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [busy, computer, ensureClaimKey, finishClaim, manualCode]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Pair with your laptop</Text>
        <Text style={styles.intro}>
          The laptop plays a short audible code. Your phone sends a secret over Tailscale first, then listens — so
          someone nearby who only hears the tones cannot pair. The bridge token never crosses the air.
        </Text>

        <Text style={styles.label}>Computer name</Text>
        <TextInput
          value={computer}
          onChangeText={setComputer}
          placeholder="mbp"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.hint}>Tailscale MagicDNS name (same tailnet as this phone).</Text>

        <Pressable
          onPress={() => void pairWithSound()}
          disabled={busy || computer.trim().length === 0}
          style={({ pressed }) => [styles.primary, (busy || computer.trim().length === 0) && styles.primaryDisabled, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>Listen for pairing sound</Text>}
        </Pressable>

        {status ? <Text style={styles.status}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Or enter the 6-character code</Text>
        <TextInput
          value={manualCode}
          onChangeText={(t) => setManualCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="ABC123"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[styles.input, styles.codeInput]}
        />
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
  label: { color: colors.textMuted, ...type.label, marginBottom: space.sm, marginLeft: space.xs },
  hint: { color: colors.textFaint, ...type.small, marginTop: space.xs, marginBottom: space.lg },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    ...type.body,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    marginBottom: space.sm,
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
