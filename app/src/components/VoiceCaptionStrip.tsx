// One-line live caption for a z0live call (DA-056): the newest thing you or Dash said. It shows in a
// chat window's dock and, when Learn or annotation hides the bubble, under the voice bar's controls,
// where it also keeps DA-058 actions available. Elsewhere the bubble is the only call surface (DA-096).
// It reserves one short line while the call is live so the screen does not jump on every turn, and the
// CC control turns it off for this device. In focus, the same actions render as cards below the caption.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { VoiceState } from "../lib/continuous-voice";
import { captionSpeaker, captionText } from "../lib/voice-captions";
import { setVoiceCaptionsEnabled, voiceCaption, voiceCaptionsEnabled } from "../store/voice-captions";
import { actOnVoiceApproval, useVoiceApprovals, type LiveApproval } from "../lib/voice-approval-actions";
import { annotate } from "../store/annotate";
import { surfaceMode } from "../store/ephemeral-mode";
import { colors, radius } from "../theme";

export function VoiceCaptionStrip({ state }: { state: VoiceState }): React.JSX.Element | null {
  const enabled = voiceCaptionsEnabled.use(on => on);
  const caption = voiceCaption.use(value => value);
  const bubbleHidden = annotate.use(s => s.active);
  const learning = surfaceMode.use(s => s === "learn");
  const approvals = useVoiceApprovals();
  const approval = bubbleHidden || learning ? approvals[0] : undefined;
  const live = state.phase !== "idle" && state.phase !== "error";
  if (!live || (!approval && !enabled)) return null;
  const text = captionText(caption);
  return <View testID="voice-caption-strip" style={styles.strip}>
    {approval ? <ApprovalLine approval={approval} /> : caption && text ? <Text testID="voice-live-caption" numberOfLines={1} ellipsizeMode="head" style={styles.text}
      accessibilityLabel={`${captionSpeaker(caption.role)} said: ${text}`}>
      <Text style={styles.who}>{captionSpeaker(caption.role)} · </Text>{text}
    </Text> : <Text testID="voice-live-caption" numberOfLines={1} style={[styles.text, styles.waiting]}>Captions on</Text>}
  </View>;
}

export function ApprovalLine({ approval, focus = false }: { approval: LiveApproval; focus?: boolean }): React.JSX.Element {
  const act = (action: "allow" | "deny" | "open") => { actOnVoiceApproval(approval, action); };
  if (approval.kind === "sudo") {
    const command = approval.request.command;
    return <View testID="voice-approval" accessibilityRole="alert" accessibilityLiveRegion="polite" style={focus ? styles.card : styles.approval}>
      <Text numberOfLines={focus ? 2 : 1} style={[styles.text, focus ? styles.cardTitle : styles.approvalText]}><Text style={styles.ask}>sudo · </Text>$ sudo {command}</Text>
      <View style={styles.buttons}><Pressable testID="voice-approval-decline" accessibilityRole="button" accessibilityLabel="Decline sudo from the call"
        onPress={() => act("deny")} hitSlop={4} style={[styles.action, focus && styles.focusAction]}><Text style={styles.actionText}>Decline</Text></Pressable>
      <Pressable testID="voice-approval-sudo" accessibilityRole="button" accessibilityLabel={`Enter sudo password for ${command}`}
        accessibilityHint="Opens the sealed sudo entry. The call keeps going. Or say open sudo."
        onPress={() => act("open")} hitSlop={4} style={[styles.action, focus && styles.focusAction, styles.primary]}><Text style={styles.primaryText}>Enter password</Text></Pressable></View>
      {focus ? <Text style={styles.spoken}>or say “open sudo”</Text> : null}
    </View>;
  }
  const { title, allowOptionId, denyOptionId, deciding } = approval;
  return <View testID="voice-approval" accessibilityRole="alert" accessibilityLiveRegion="polite" style={focus ? styles.card : styles.approval}>
    <Text numberOfLines={focus ? 2 : 1} style={[styles.text, focus ? styles.cardTitle : styles.approvalText]}><Text style={styles.ask}>Needs OK · </Text>{deciding ? "sending…" : title}</Text>
    <View style={styles.buttons}>{denyOptionId ? <Pressable testID="voice-approval-deny" accessibilityRole="button" accessibilityLabel={`Deny ${title} from the call`}
      accessibilityState={{ disabled: deciding }} disabled={deciding} onPress={() => act("deny")} hitSlop={4} style={[styles.action, focus && styles.focusAction]}>
      <Text style={styles.actionText}>Deny</Text></Pressable> : null}
    {allowOptionId ? <Pressable testID="voice-approval-allow" accessibilityRole="button" accessibilityLabel={`Allow ${title} once from the call`}
      accessibilityHint="Or say allow once." accessibilityState={{ disabled: deciding }} disabled={deciding}
      onPress={() => act("allow")} hitSlop={4} style={[styles.action, focus && styles.focusAction, styles.primary]}><Text style={styles.primaryText}>Allow once</Text></Pressable> : null}</View>
    {focus && allowOptionId ? <Text style={styles.spoken}>or say “allow”</Text> : null}
  </View>;
}

/** The CC control. It sits with the call's Mute/End so turning captions off never needs a menu. */
export function VoiceCaptionsToggle({ style, textStyle }: { style?: object; textStyle?: object }): React.JSX.Element {
  const enabled = voiceCaptionsEnabled.use(on => on);
  return <Pressable testID="voice-captions-toggle" accessibilityRole="button"
    accessibilityLabel={enabled ? "Hide live captions" : "Show live captions"} accessibilityState={{ selected: enabled }}
    onPress={() => setVoiceCaptionsEnabled(!enabled)} style={[styles.toggle, style]}>
    <Text style={[styles.toggleText, enabled && styles.toggleOn, textStyle]}>CC</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  strip: { minHeight: 20, marginHorizontal: 8, paddingHorizontal: 12, justifyContent: "center" },
  text: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  who: { color: colors.textTertiary, fontWeight: "600" },
  waiting: { color: colors.textFaint },
  card: { padding: 14, gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.surface },
  cardTitle: { color: colors.text, fontSize: 15, lineHeight: 21 },
  buttons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  spoken: { color: colors.textMuted, fontSize: 12 },
  approval: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6 },
  approvalText: { flex: 1, minWidth: 0, color: colors.text },
  ask: { color: colors.gold, fontWeight: "700" },
  action: { minHeight: 32, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hair },
  focusAction: { minHeight: 44, paddingHorizontal: 14 },
  actionText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { color: colors.bg, fontSize: 12, fontWeight: "700" },
  toggle: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  toggleText: { color: colors.textFaint, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  toggleOn: { color: colors.text },
});
