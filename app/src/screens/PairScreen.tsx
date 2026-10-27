import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { GlassSurface } from "../components/GlassSurface";
import { PrimaryButton } from "../components/PrimaryButton";
import { haptic } from "../haptics";
import { parseIdentityPairLink } from "../../../shared/z0bridge-identity";
import { claimIdentity, identitySecretKey } from "../lib/identity-client";
import { setSecret } from "../lib/secure";
import { newClaimKey } from "../lib/pair-crypto";
import { claimLivePair, claimPairCode, hearPairTones, settingsFromClaim, startSonicPair } from "../lib/pair-api";
import { connectSettings } from "../lib/settings-flow";
import type { ScreenProps } from "../navigation";
import { bridge } from "../net/bridge";
import { nextPrefill } from "../lib/deep-link";
import { saveSettings, store } from "../store/app";
import { withPairedEndpoint } from "../lib/bridge-failover";
import type { Settings } from "../model";
import { colors, radius, space, type, surfaces } from "../theme";
import { screenBack } from "../lib/screen-back";
import { pairActionState, type PairAction } from "../lib/a11y-pair-screen";

const RECORD_MS = 6500;

export function PairScreen({ navigation, route }: ScreenProps<"Pair">) {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [computer, setComputer] = useState(route.params?.address ?? "");
  const [manualCode, setManualCode] = useState(route.params?.code ?? "");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [identityLink, setIdentityLink] = useState(route.params?.identityLink ?? "");
  useEffect(() => { if (route.params?.identityLink) { setIdentityLink(route.params.identityLink); if (route.params.address) setComputer(route.params.address); } }, [route.params?.identityLink, route.params?.address]);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<PairAction | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimKeyRef = useRef<Uint8Array | null>(null);
  const attemptRef = useRef<AbortController | null>(null);
  const appliedLinkRef = useRef<string | null>(null);

  // A magic link can (re)open an already mounted Pair, e.g. first run, when Pair is
  // the initial route. Apply each new address/code once; never a credential.
  const linkAddress = route.params?.address;
  const linkCode = route.params?.code;
  useEffect(() => {
    const next = nextPrefill({ address: linkAddress, code: linkCode }, appliedLinkRef.current);
    if (!next) return;
    appliedLinkRef.current = next.key;
    setComputer(next.prefill.address);
    setManualCode(next.prefill.code);
    setError(null);
    setStatus("Link filled the address and code. Paste the bootstrap token, then Pair with code.");
  }, [linkAddress, linkCode]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("blur", () => attemptRef.current?.abort());
    return () => {
      unsubscribe();
      attemptRef.current?.abort();
    };
  }, [navigation]);

  const ensureClaimKey = useCallback((): Uint8Array => {
    claimKeyRef.current ??= newClaimKey();
    return claimKeyRef.current;
  }, []);

  const finishClaim = useCallback(
    async (code: string, claimKey?: Uint8Array) => {
      setError(null);
      setStatus("Finishing secure pairing…");
      const claim = await claimPairCode(computer, code, claimKey, bootstrapToken);
      await connectClaim(claim);
    },
    [computer, bootstrapToken, navigation],
  );

  const connectClaim = useCallback(
    async (claim: Awaited<ReturnType<typeof claimPairCode>>) => {
      const attempt = new AbortController();
      attemptRef.current?.abort();
      attemptRef.current = attempt;
      await connectSettings({
        settings: withPairedEndpoint(store.get().settings, settingsFromClaim(claim)),
        connection: store,
        save: saveSettings,
        start: (settings) => bridge.start(settings, { failover: false }),
        signal: attempt.signal,
        onConnected: () => {
          haptic.success();
          claimKeyRef.current = null;
          setBootstrapToken("");
          navigation.replace("Main");
        },
      });
    },
    [navigation],
  );

  const pairWithSound = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setBusyAction("sound");
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
      const playing = startSonicPair(computer, claimKey, bootstrapToken);
      await sleep(RECORD_MS);
      await recorder.stop();
      await playing;

      const uri = recorder.uri;
      if (!uri) throw new Error("Recording failed");
      setStatus("Decoding pairing tones…");
      const bytes = new Uint8Array(await new File(uri).arrayBuffer());
      const mime = uri.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/m4a";
      const claim = await hearPairTones(computer, claimKey, bytes, mime, bootstrapToken);
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
      setBusyAction(null);
      setStatus(null);
    }
  }, [busy, computer, bootstrapToken, connectClaim, ensureClaimKey, recorder]);

  const pairOverTailscale = useCallback(async () => {
    if (busy || computer.trim().length === 0 || bootstrapToken.trim().length === 0) return;
    setBusy(true);
    setBusyAction("tailscale");
    setError(null);
    try {
      setStatus(`Connecting to ${computer.trim()}…`);
      const claim = await claimLivePair(computer, bootstrapToken);
      await connectClaim(claim);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
    } finally {
      setBusy(false);
      setBusyAction(null);
      setStatus(null);
    }
  }, [busy, computer, bootstrapToken, connectClaim]);

  const pairWithCode = useCallback(async () => {
    if (busy || computer.trim().length === 0 || bootstrapToken.trim().length === 0 || manualCode.trim().length !== 6) return;
    setBusy(true);
    setBusyAction("code");
    setError(null);
    try {
      await finishClaim(manualCode.trim());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      haptic.error();
    } finally {
      setBusy(false);
      setBusyAction(null);
      setStatus(null);
    }
  }, [busy, computer, bootstrapToken, finishClaim, manualCode]);

  const pairWithIdentity = async () => {
    if (busy) return;
    setBusy(true); setBusyAction("identity"); setError(null);
    try {
      if (Platform.OS === "web") throw new Error("Use the native Dash app for z0bridge pairing. Browser WebSockets cannot send authorization headers.");
      const link = parseIdentityPairLink(identityLink);
      if (!link) throw new Error("Paste a valid Dash v2 z0bridge pairing link");
      if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(computer.trim())) throw new Error("Enter the Dash bridge address and port (not the identity service)");
      // Enrollment codes are single-use. A previous successful claim may already have saved a
      // credential even if connecting timed out. Retry that connection, never spend the code again.
      const saved = store.get().settings;
      let settings: Settings;
      if (saved?.identity && saved.address === computer.trim() && saved.identity.url === link.url && saved.identity.kid === link.kid) {
        settings = saved;
      } else {
        const claim = await claimIdentity(link);
        await setSecret(identitySecretKey(claim.enrollment.credentialId), claim.credential);
        settings = { address: computer.trim(), token: "", harness: "hermes", inAppFeedback: true, identity: claim.enrollment };
      }
      const attempt = new AbortController();
      attemptRef.current?.abort(); attemptRef.current = attempt;
      await connectSettings({ settings: withPairedEndpoint(saved, settings), connection: store, save: saveSettings, start: s => bridge.start(s, { failover: false }), signal: attempt.signal,
        onConnected: () => { setIdentityLink(""); haptic.success(); navigation.replace("Main"); },
      });
    } catch (error) { setError(error instanceof Error ? error.message : "Identity pairing failed"); }
    finally { setBusy(false); setBusyAction(null); }
  };

  const formA11y = { computer, bootstrapToken, identityLink, manualCode, busy, activeAction: busyAction };
  const identityA11y = pairActionState("identity", formA11y);
  const tailscaleA11y = pairActionState("tailscale", formA11y);
  const soundA11y = pairActionState("sound", formA11y);
  const codeA11y = pairActionState("code", formA11y);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}><Canvas />
      <ScreenHeader title="Connect" onBack={() => screenBack(navigation)} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Pair with your laptop</Text>
        <Text style={styles.intro}>
          Same Tailscale tailnet as this phone. Computer is the MagicDNS name or Tailscale IP (port 4747).
        </Text>

        <GlassSurface variant="raised" borderRadius={radius.sm} style={styles.inputWrap}>
          <TextInput
            value={computer}
            accessibilityLabel="Laptop bridge address"
            accessibilityHint="Enter the laptop Tailscale address or MagicDNS name."
            onChangeText={setComputer}
            placeholder="100.64.0.1"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            style={styles.inputInner}
          />
        </GlassSurface>
        <Text style={styles.hint}>Use the Tailscale IPv4 the bridge prints if MagicDNS does not resolve.</Text>

        <Text style={styles.sectionLabel}>Optional: z0bridge identity</Text>
        <TextInput value={identityLink} onChangeText={setIdentityLink} accessibilityLabel="z0bridge pairing link"
          accessibilityHint="Optional private identity pairing link from your laptop."
          placeholder="dash://pair?v=2…" secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.inputInner} />
        <Text style={styles.hint}>Opt in only when the host enables identity. Confirming switches this app to a scoped credential in Keychain/Keystore; legacy pairing is not revoked. Bridge address above is still required.</Text>
        <PrimaryButton onPress={() => void pairWithIdentity()} disabled={identityA11y.disabled}
          accessibilityState={identityA11y} accessibilityLabel="Confirm z0bridge pairing"
          label="Confirm z0bridge pairing" />

        <GlassSurface variant="raised" borderRadius={radius.sm} style={styles.inputWrap}>
          <TextInput
            value={bootstrapToken}
            onChangeText={setBootstrapToken}
            placeholder="Bootstrap token"
            accessibilityLabel="Bootstrap token"
            accessibilityHint="Private enrollment token from your computer. Its value is hidden."
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            style={styles.inputInner}
          />
        </GlassSurface>
        <Text style={styles.hint}>Transfer ~/.dash/bootstrap-token privately from your computer. Used only for enrollment; not saved.</Text>

        <PrimaryButton onPress={() => void pairOverTailscale()} disabled={tailscaleA11y.disabled}
          accessibilityState={tailscaleA11y} accessibilityLabel="Pair over Tailscale"
          label={tailscaleA11y.busy ? "Pairing…" : "Pair over Tailscale"} />

        <Pressable
          onPress={() => void pairWithSound()}
          disabled={soundA11y.disabled}
          accessibilityRole="button"
          accessibilityLabel="Listen for pairing sound"
          accessibilityHint="Listens for pairing tones from your laptop speakers."
          accessibilityState={soundA11y}
          style={({ pressed }) => [styles.secondary, soundA11y.disabled && styles.secondaryDisabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Listen for pairing sound</Text>
        </Pressable>

        {status ? <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text> : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="assertive"
          accessibilityLabel="Pairing failed. Check the connection details.">{error}</Text> : null}

        <Text style={styles.sectionLabel}>Have a code from the computer or a link?</Text>
        <GlassSurface variant="raised" borderRadius={radius.sm} style={styles.inputWrap}>
          <TextInput
            value={manualCode}
            accessibilityLabel="Pairing code"
            accessibilityHint="Six-character code shown on your computer."
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
          disabled={codeA11y.disabled}
          accessibilityRole="button"
          accessibilityLabel="Pair with code"
          accessibilityHint="Pairs using the six-character code from your computer."
          accessibilityState={codeA11y}
          style={({ pressed }) => [styles.secondary, codeA11y.disabled && styles.secondaryDisabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Pair with code</Text>
        </Pressable>

        <Pressable onPress={() => navigation.navigate("Settings", { firstRun: true })}
          accessibilityRole="link" accessibilityLabel="Enter address and token manually"
          accessibilityHint="Opens manual connection settings." style={styles.linkWrap}>
          <Text style={styles.link}>Enter address and token manually</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surfaces.scene },
  content: { paddingHorizontal: space.lg },
  title: { color: colors.text, ...type.title, marginBottom: space.sm },
  intro: { color: colors.textMuted, ...type.body, marginBottom: space.xl },
  hint: { color: colors.textFaint, ...type.small, marginTop: space.xs, marginBottom: space.lg },
  inputWrap: { marginBottom: space.sm },
  inputInner: {
    color: colors.text,
    ...type.mono,
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
  // `.z-btn` ghost: glass tint, hairline rim, pill.
  secondary: {
    marginTop: space.sm,
    borderRadius: radius.pill,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(236,232,223,.06)",
    borderWidth: 1,
    borderColor: "rgba(236,232,223,.16)",
    borderTopColor: "rgba(255,255,255,.22)",
  },
  sectionLabel: { color: colors.textMuted, ...type.label, marginTop: space.xl, marginBottom: space.sm },
  secondaryDisabled: { opacity: 0.45 },
  secondaryText: { color: colors.text, ...type.heading },
  status: { color: colors.textMuted, ...type.small, marginTop: space.md, textAlign: "center" },
  error: { color: colors.danger, ...type.small, marginTop: space.md, textAlign: "center" },
  linkWrap: { marginTop: space.xxl, alignItems: "center", minHeight: 44, justifyContent: "center" },
  link: { color: colors.textMuted, ...type.body, textDecorationLine: "underline" },
  pressed: { opacity: 0.75 },
});
