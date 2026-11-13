import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { hermesBotIdentity } from "../lib/bot-identity";
import type { OrbPhase } from "../lib/orb-phase";
import { store } from "../store/app";
import { colors, fonts } from "../theme";
import { AgentOrb } from "./AgentOrb";
import { ComposerMotion, SendReadiness } from "./ComposerMotion";
import { PressScale } from "./PressScale";

const PHASES: readonly OrbPhase[] = ["idle", "thinking", "tool", "streaming", "waiting-approval", "listening", "speaking", "connecting"];

/** Real roster identities; the three named owner profiles remain available offline for comparison. */
export function BotFaceLab() {
  const hosts = store.use(s => s.connection.hosts);
  const profiles = useMemo(() => [...new Set(["default", "chiefstaff", "clean", ...hosts.flatMap(host => host.agents.filter(agent => agent.kind === "hermes").flatMap(agent => agent.profileId ? [agent.profileId] : []))])], [hosts]);
  const [profile, setProfile] = useState("clean");
  const [phase, setPhase] = useState<OrbPhase>("thinking");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const identity = hermesBotIdentity(profile);
  return <View style={styles.root} testID="lab-bot-faces">
    <Text style={styles.title}>Bot faces · profile identities</Text>
    <Text style={styles.note}>Named profiles + discovered roster. Motion samples below are explicit Lab states, not live activity.</Text>
    <View style={styles.row}>{profiles.map(name => <PressScale key={name} accessibilityRole="button" accessibilityLabel={`Bot profile ${name}`} accessibilityState={{ selected: name === profile }} onPress={() => setProfile(name)} style={styles.choice}>
      <AgentOrb face={hermesBotIdentity(name).face} size={32} thinking={{ phase: "idle" }} animated={false} label={`${name} face`} /><Text style={styles.note}>{name}</Text>
    </PressScale>)}</View>
    <Text style={styles.title}>{identity.name} · all phases</Text>
    <View style={styles.row}>{PHASES.map(value => <PressScale key={value} accessibilityRole="button" accessibilityLabel={`Face phase ${value}`} accessibilityState={{ selected: phase === value }} onPress={() => setPhase(value)} style={styles.choice}>
      <AgentOrb face={identity.face} size={40} thinking={{ phase: value }} animated={value === phase} label={`${identity.name} ${value}`} /><Text style={styles.note}>{value}</Text>
    </PressScale>)}</View>
    <Text style={styles.title}>Input motion · sandbox</Text>
    <PressScale accessibilityRole="button" accessibilityLabel="Toggle composer working sample" onPress={() => setBusy(value => !value)} style={styles.choice}><Text style={styles.note}>Working sample: {busy ? "on" : "off"}</Text></PressScale>
    <View style={styles.sample}><ComposerMotion busy={busy} focused={focused} /><TextInput accessibilityLabel="Composer motion sandbox" placeholder="Type to inspect readiness (never sent)" placeholderTextColor={colors.textMuted} value={text} onChangeText={setText} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} multiline style={styles.input} /><SendReadiness ready={Boolean(text.trim())}><PressScale accessibilityRole="button" accessibilityLabel="Sandbox send (no network)" disabled={!text.trim()} onPress={() => setNotice("Sandbox only · nothing sent")} style={styles.choice}><Text style={styles.title}>↑</Text></PressScale></SendReadiness></View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.note}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 12, padding: 16 },
  sample: { position: "relative", borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, minHeight: 44, color: colors.text },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  title: { fontSize: 14, color: colors.text, fontFamily: fonts.semibold },
  note: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  choice: { minHeight: 44, padding: 6, alignItems: "center", gap: 6 },
});
