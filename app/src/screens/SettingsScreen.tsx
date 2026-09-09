import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppNav } from "../components/AppNav";
import { GlassSurface } from "../components/GlassSurface";
import { haptic } from "../haptics";
import { normalizeAddress } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge } from "../net/bridge";
import { forgetEverything, saveSettings, store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { confirmDestructive } from "../util";

export function SettingsScreen({ navigation }: ScreenProps<"Settings">) {
  const insets = useSafeAreaInsets();
  const settings = store.use((s) => s.settings);
  const connection = store.use((s) => s.connection);
  const firstRun = settings === null;

  const [address, setAddress] = useState(settings?.address ?? "");
  const [token, setToken] = useState(settings?.token ?? "");
  const [cwd, setCwd] = useState(settings?.cwd ?? "");
  const [submitted, setSubmitted] = useState(false);

  const dirty =
    normalizeAddress(address) !== (settings?.address ?? "") ||
    token.trim() !== (settings?.token ?? "") ||
    (cwd.trim() || undefined) !== settings?.cwd;
  const canSave = normalizeAddress(address).length > 0 && token.trim().length > 0 && (dirty || connection.status !== "online");

  // First run: once the bridge answers, drop straight into chat.
  useEffect(() => {
    if (firstRun && submitted && connection.status === "online") {
      haptic.success();
      navigation.replace("Main");
    }
  }, [firstRun, submitted, connection.status, navigation]);

  const save = () => {
    const next = {
      address: normalizeAddress(address),
      token: token.trim(),
      harness: settings?.harness ?? "omp",
      cwd: cwd.trim() || undefined,
    };
    saveSettings(next);
    bridge.start(next);
    setSubmitted(true);
    haptic.tap();
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
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AppNav navigation={navigation} tab={1} />
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
              Chat with the coding agents on your own computer. Run the bridge there, then enter what it prints.
            </Text>
          ) : null}

          <Text style={styles.label}>Bridge</Text>
          <GlassSurface variant="raised" borderRadius={radius.lg} style={styles.card}>
            <Field
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="100.78.215.21:4747"
              autoCapitalize="none"
              keyboardType={Platform.OS === "ios" ? "url" : "default"}
              autoComplete="off"
            />
            <View style={styles.divider} />
            <Field
              label="Token"
              value={token}
              onChangeText={setToken}
              placeholder="from the bridge output"
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

          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [styles.primary, !canSave && styles.primaryDisabled, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, !canSave && styles.primaryTextDisabled]}>
              {firstRun ? "Connect" : dirty ? "Save and reconnect" : "Reconnect"}
            </Text>
          </Pressable>

          {connection.harnesses.length > 0 ? (
            <>
              <Text style={styles.label}>Harnesses on {connection.host}</Text>
              <GlassSurface variant="raised" borderRadius={radius.lg} style={styles.card}>
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

          <Text style={styles.label}>On your computer</Text>
          <GlassSurface variant="raised" borderRadius={radius.lg} style={styles.card}>
            <Text style={styles.mono}>cd dash/server && bun run start</Text>
          </GlassSurface>
          <Text style={styles.help}>
            The bridge prints its Tailscale address and token. Both devices need to be on the same tailnet.
          </Text>

          <Pressable onPress={() => navigation.navigate("Pair")} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>Pair nearby (sonic)</Text>
          </Pressable>

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
  label: { color: colors.textMuted, ...type.label, marginTop: space.xl, marginBottom: space.sm, marginLeft: space.xs },
  card: {
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space.lg },
  field: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, minHeight: 52 },
  fieldLabel: { width: 72, color: colors.text, ...type.body },
  input: {
    flex: 1,
    color: colors.text,
    ...type.body,
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
    borderRadius: radius.pill,
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
