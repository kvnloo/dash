// One-line live caption for a z0live call (DA-056): the newest thing you or Dash said, shown under
// the voice controls without a panel. It reserves one short line while the call is live so the
// screen does not jump on every turn, and the CC control turns it off for this device.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { debugNavigationRef } from "../debug/nav";
import type { VoiceState } from "../lib/continuous-voice";
import { captionSpeaker, captionText } from "../lib/voice-captions";
import { setVoiceCaptionsEnabled, voiceCaption, voiceCaptionsEnabled } from "../store/voice-captions";
import { colors, radius } from "../theme";

/** Full-screen Voice already shows the transcript; the strip would only repeat it there. */
function useOnVoiceScreen(): boolean {
  const [onVoice, setOnVoice] = useState(() => debugNavigationRef.getCurrentRoute()?.name === "Voice");
  useEffect(() => {
    const sync = () => setOnVoice(debugNavigationRef.getCurrentRoute()?.name === "Voice");
    const unsubscribe = debugNavigationRef.addListener("state", sync);
    sync();
    return unsubscribe;
  }, []);
  return onVoice;
}

export function VoiceCaptionStrip({ state }: { state: VoiceState }): React.JSX.Element | null {
  const enabled = voiceCaptionsEnabled.use(on => on);
  const caption = voiceCaption.use(value => value);
  const onVoiceScreen = useOnVoiceScreen();
  const live = state.phase !== "idle" && state.phase !== "error";
  if (!live || !enabled || onVoiceScreen) return null;
  const text = captionText(caption);
  return <View testID="voice-caption-strip" style={styles.strip}>
    {caption && text ? <Text testID="voice-live-caption" numberOfLines={1} ellipsizeMode="head" style={styles.text}
      accessibilityLabel={`${captionSpeaker(caption.role)} said: ${text}`}>
      <Text style={styles.who}>{captionSpeaker(caption.role)} · </Text>{text}
    </Text> : <Text testID="voice-live-caption" numberOfLines={1} style={[styles.text, styles.waiting]}>Captions on</Text>}
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
  toggle: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  toggleText: { color: colors.textFaint, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  toggleOn: { color: colors.text },
});
