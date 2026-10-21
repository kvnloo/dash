import { ModelsPanel } from "../components/ModelsPanel";
import { setHandedness, useHandedness } from "../lib/useHandedness";
import type { Handedness } from "../lib/handedness";
import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppNav } from "../components/AppNav";
import { GlassSurface } from "../components/GlassSurface";
import { PrimaryButton } from "../components/PrimaryButton";
import { haptic } from "../haptics";
import { connectSettings } from "../lib/settings-flow";
import { normalizeAddress } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge } from "../net/bridge";
import { forgetEverything, saveSettings, store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { confirmDestructive } from "../util";
import { screenBack } from "../lib/screen-back";

export function SettingsScreen({ navigation, route }: ScreenProps<"Settings">) {
  const thumb = useHandedness();
  const insets = useSafeAreaInsets();
  const settings = store.use((s) => s.settings);
  const connection = store.use((s) => s.connection);
  const [firstRun] = useState(() => route.params?.firstRun ?? settings === null);

  const [address, setAddress] = useState(settings?.address ?? "");
  const [token, setToken] = useState(settings?.token ?? "");
  const [cwd, setCwd] = useState(settings?.cwd ?? "");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const attemptRef = useRef<AbortController | null>(null);

  const dirty =
    normalizeAddress(address) !== (settings?.address ?? "") ||
    token.trim() !== (settings?.token ?? "") ||
    (cwd.trim() || undefined) !== settings?.cwd;
  const identity = settings?.identity && !token.trim() ? settings.identity : undefined;
  const canSave = !saving && normalizeAddress(address).length > 0 && (token.trim().length > 0 || identity !== undefined) && (dirty || connection.status !== "online");

  useEffect(() => {
    const unsubscribe = navigation.addListener("blur", () => attemptRef.current?.abort());
    return () => {
      unsubscribe();
      attemptRef.current?.abort();
    };
  }, [navigation]);

  const save = async () => {
    if (!canSave) return;
    const attempt = new AbortController();
    attemptRef.current?.abort();
    attemptRef.current = attempt;
    setSaving(true);
    setSaveError(null);
    const next = {
      ...store.get().settings,
      identity,
      address: normalizeAddress(address),
      token: token.trim(),
      harness: settings?.harness ?? "omp",
      cwd: cwd.trim() || undefined,
      inAppFeedback: settings?.inAppFeedback ?? true,
    };
    haptic.tap();
    try {
      await connectSettings({
        settings: next,
        connection: store,
        save: saveSettings,
        start: (saved) => bridge.start(saved),
        signal: attempt.signal,
        onConnected: () => {
          haptic.success();
          if (firstRun || !navigation.canGoBack()) navigation.replace("Main");
          else navigation.goBack();
        },
      });
    } catch (error) {
      if (!attempt.signal.aborted) {
        setSaveError(error instanceof Error ? error.message : String(error));
        haptic.error();
      }
    } finally {
      if (attemptRef.current === attempt) {
        attemptRef.current = null;
        setSaving(false);
      }
    }
  };

  const forget = () => {
    confirmDestructive("Forget this bridge?", "Removes the saved address, token, and every chat on this phone.", "Forget", () => {
      bridge.stop();
      void forgetEverything().then(() => navigation.replace("Settings"));
    });
  };

  const statusLine = (() => {
    switch (connection.status) {
      case "online":
        return { color: colors.ok, text: `Connected to ${connection.host ?? "bridge"}` };
      case "connecting":
        return { color: colors.warn, text: "Connecting…" };
      case "offline":
        return { color: colors.danger, text: connection.error ?? "Offline" };
      case "idle":
        return { color: colors.textFaint, text: "Not connected" };
      default: {
        const _exhaustive: never = connection.status;
        return _exhaustive;
      }
    }
  })();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}><Canvas />
      <AppNav navigation={navigation} tab={1} />
      <ScreenHeader title="Settings" onBack={() => screenBack(navigation)} />
      <KeyboardAvoidingView style={styles.body} behavior="padding">
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {firstRun ? (
            <Pressable onPress={() => navigation.replace("Pair")} style={({ pressed }) => [styles.linkWrap, pressed && styles.pressed]}>
              <Text style={styles.link}>← Pair with sonic code instead</Text>
            </Pressable>
          ) : null}
          {firstRun ? (
            <Text style={styles.intro}>
              Chat with the coding agents on your own computer. Run the bridge there, then enter its address and privately transferred execution token.
            </Text>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityState={{ expanded: modelsOpen }} onPress={() => setModelsOpen(!modelsOpen)} style={styles.secondary}><Text style={styles.secondaryText}>Models {modelsOpen ? "−" : "+"}</Text></Pressable>
          {modelsOpen ? <ModelsPanel /> : null}
          <Text style={styles.label}>Display</Text>
          <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
            <View style={styles.harnessRow}><Text style={styles.harnessName}>Thumb side</Text></View>
            <View style={{ flexDirection: "row", paddingHorizontal: space.md, gap: space.sm }}>
              {(["right", "left", "auto"] satisfies Handedness[]).map(value => <Pressable key={value}
                accessibilityRole="radio" accessibilityLabel={`${value[0]?.toUpperCase()}${value.slice(1)} handedness`}
                accessibilityState={{ checked: thumb.preference === value, disabled: !settings }}
                aria-checked={thumb.preference === value} disabled={!settings}
                onPress={() => { setHandedness(value); haptic.select(); }}
                style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: thumb.preference === value ? colors.gold : colors.border }}>
                <Text style={{ ...type.body, color: thumb.preference === value ? colors.gold : colors.textMuted }}>{value[0]?.toUpperCase()}{value.slice(1)}</Text>
              </Pressable>)}
            </View>
            <Text style={[styles.help, { padding: space.md }]}>{settings ? "Auto follows a system preference when available; otherwise Right. This platform exposes no handedness signal. Long-press the composer mic to switch hands." : "Pair a bridge to save display preferences."}</Text>
          </GlassSurface>
          <Text style={styles.label}>Bridge</Text>
          <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
            <Field
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="100.64.0.1:4747"
              autoCapitalize="none"
              keyboardType={Platform.OS === "ios" ? "url" : "default"}
              autoComplete="off"
            />
            <View style={styles.divider} />
            <Field
              label="Token"
              value={token}
              onChangeText={setToken}
              placeholder="from ~/.dash/token (private)"
              autoCapitalize="none"
              autoComplete="off"
              secure
            />
            <View style={styles.divider} />
            <Field
              label="Folder"
              value={cwd}
              onChangeText={setCwd}
              placeholder={connection.cwd ? `${connection.cwd} (bridge default)` : "optional, e.g. ~/code/myapp"}
              autoCapitalize="none"
              autoComplete="off"
            />
          </GlassSurface>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusLine.color }]} />
            <Text style={styles.statusText} numberOfLines={2}>
              {statusLine.text}
            </Text>
          </View>

          <PrimaryButton onPress={() => void save()} disabled={!canSave} label={saving ? "Connecting…" : firstRun ? "Connect" : dirty ? "Save and reconnect" : "Reconnect"} />
          {saveError ? <Text style={[styles.help, styles.dangerText]} accessibilityRole="alert">{saveError}</Text> : null}

          {connection.harnesses.length > 0 ? (
            <>
              <Text style={styles.label}>Harnesses on {connection.host}</Text>
              <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
                {connection.harnesses.map((h, i) => (
                  <View key={h.id}>
                    {i > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.harnessRow}>
                      <Text style={styles.harnessName}>{h.name}</Text>
                      <View
                        style={[styles.statusDot, { backgroundColor: h.available ? colors.ok : colors.textFaint }]}
                        accessibilityLabel={h.available ? "Installed" : "Not found"}
                      />
                    </View>
                  </View>
                ))}
              </GlassSurface>
            </>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Approvals" onPress={() => navigation.navigate("Approvals")} style={styles.secondary}><Text style={styles.secondaryText}>Review approvals</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Component lab" onPress={() => navigation.navigate("Lab")} style={styles.secondary}><Text style={styles.secondaryText}>Component lab</Text></Pressable>
          <Text style={styles.label}>On your computer</Text>
          <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
            <Text style={styles.mono}>cd bridge && bun run start</Text>
          </GlassSurface>
          <Text style={styles.help}>
            Run this from the Dash repository. The bridge prints its Tailscale address, never credentials. Transfer ~/.dash/token privately for manual setup, or use Pair with ~/.dash/bootstrap-token. Both devices need the same tailnet.
          </Text>

          <Pressable onPress={() => navigation.navigate("Pair")} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>Pair nearby (sonic)</Text>
          </Pressable>

          {!firstRun && settings ? (
            <>
              <Text style={styles.label}>Beta</Text>
              <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
                <Pressable
                  onPress={() => {
                    saveSettings({ ...settings, inAppFeedback: !settings.inAppFeedback });
                    haptic.tap();
                  }}
                  style={({ pressed }) => [styles.harnessRow, pressed && styles.pressed]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: settings.inAppFeedback }}
                  accessibilityLabel="In-app feedback"
                >
                  <Text style={styles.harnessName}>In-app feedback</Text>
                  <Text style={styles.statusText}>{settings.inAppFeedback ? "On" : "Off"}</Text>
                </Pressable>
              </GlassSurface>
              <Text style={styles.help}>
                Voice, typed notes on Main, and long-press on rows go to the Dash secondmate until you turn this off.
              </Text>
            </>
          ) : null}

          {!firstRun ? (
            <Pressable onPress={forget} style={({ pressed }) => [styles.danger, pressed && styles.pressed]}>
              <Text style={styles.dangerText}>Forget this bridge</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  label,
  secure,
  ...input
}: {
  label: string;
  secure?: boolean;
} & Pick<
  React.ComponentProps<typeof TextInput>,
  "value" | "onChangeText" | "placeholder" | "autoCapitalize" | "keyboardType" | "autoComplete"
>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        style={styles.input}
        placeholderTextColor={colors.textFaint}
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardAppearance="dark"
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm },
  intro: { color: colors.textMuted, ...type.body, marginBottom: space.xl },
  label: { color: colors.text, ...type.cardTitle, marginTop: space.xl, marginBottom: space.sm, marginLeft: space.xs },
  card: {
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg },
  field: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, minHeight: 52 },
  fieldLabel: { width: 72, color: colors.text, ...type.body },
  input: {
    flex: 1,
    color: colors.text,
    ...type.mono,
    paddingVertical: 14,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: space.md, marginLeft: space.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.textMuted, ...type.small, flex: 1 },
  primary: {
    marginTop: space.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryDisabled: { backgroundColor: colors.surfaceRaised },
  secondary: {
    marginTop: space.lg,
    borderRadius: radius.sm,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text, ...type.body },
  primaryText: { color: colors.onAccent, ...type.heading },
  primaryTextDisabled: { color: colors.textFaint },
  pressed: { opacity: 0.75 },
  harnessRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: 14 },
  harnessName: { color: colors.text, ...type.body },
  mono: { color: colors.text, ...type.mono, padding: space.lg },
  help: { color: colors.textMuted, ...type.small, marginTop: space.sm, marginLeft: space.xs },
  danger: { marginTop: space.xxl, alignItems: "center", paddingVertical: 14 },
  dangerText: { color: colors.danger, ...type.body },
  linkWrap: { marginBottom: space.md, alignItems: "center" },
  link: { color: colors.textMuted, ...type.body, textDecorationLine: "underline" },
});
