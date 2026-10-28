import { toggleHandedness, useHandedness } from "../lib/useHandedness";
import { Feather } from "@expo/vector-icons";
import { type RefObject, memo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { applyScopePrefix } from "../lib/global-search";
import { appendMentionTrigger } from "../lib/composer-suggestion-request";
import { insertAtCursor, type Selection } from "../lib/mic-gesture";
import { useRecordedSpeech } from "../lib/useRecordedSpeech";
import { PRESS_SCALE } from "../motion";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { MicButton } from "./MicButton";
import { popIn, popOut } from "./motion-enter";
import { PressScale } from "./PressScale";
import { ComposerSuggestions } from "./ComposerSuggestions";

interface Props {
  value: string;
  blurTarget?: RefObject<View | null>;
  onChange(value: string): void;
  onScope(label: string): void;
  onClear?(): void;
  onVoice?(): void;
  onSend?(text: string): void;
  placeholder?: string;
  /** Bottom dock on main screen — chips expand upward. */
  dock?: "top" | "bottom";
}

export const GlobalSearchBar = memo(function GlobalSearchBar({
  value,
  blurTarget,
  onChange,
  onScope,
  onClear,
  onVoice,
  onSend,
  placeholder = "Message Dash",
  dock = "top",
}: Props) {
  const thumb = useHandedness();
  const inputRef = useRef<TextInput>(null);
  const suppressMentionPress = useRef(false);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<{ value: string; range: Selection } | null>(null);
  const [cursor, setCursor] = useState<Selection | undefined>(undefined);
  const [dictating, setDictating] = useState(false);
  const activeCursor = selection?.value === value ? selection.range.start : value.length;
  const canSend = value.trim().length > 0;

  const speech = useRecordedSpeech("dictation", transcript => {
    const next = insertAtCursor(value, selection?.value === value ? selection.range : null, transcript);
    const range = { start: next.cursor, end: next.cursor };
    setSelection({ value: next.text, range });
    setCursor(range);
    onChange(next.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  });
  const speechBusy = ["preparing", "recording", "transcribing"].includes(speech.state.phase);
  const onDictate = () => {
    setDictating(true);
    if (speechBusy) void speech.end();
    else void speech.begin();
  };
  const onLive = () => onVoice?.();

  const changeValue = (next: string) => {
    setSelection(null);
    setCursor(undefined);
    onChange(next);
  };

  const insertMention = () => {
    // The long-press now owns handedness, so it must never insert a stray @.
    if (suppressMentionPress.current) {
      suppressMentionPress.current = false;
      return;
    }
    const next = appendMentionTrigger(value);
    if (next !== value) changeValue(next);
    inputRef.current?.focus();
  };

  return (
    <View style={[styles.wrap, dock === "bottom" && styles.wrapBottom]}>
      <ComposerSuggestions text={value} cursor={activeCursor} onChange={changeValue} />

      {speech.state.note ? (
        <View style={styles.speechRow}>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole={speech.state.phase === "error" ? "alert" : "text"}
            style={[styles.speechNote, speech.state.phase === "error" && styles.speechError]}
          >
            {speech.state.note}
          </Text>
          {speechBusy ? (
            <PressScale accessibilityRole="button" accessibilityLabel="Stop main dictation" onPress={() => void speech.end()} style={styles.speechAction}>
              <Text style={styles.speechActionText}>Stop</Text>
            </PressScale>
          ) : speech.state.phase === "error" ? (
            <PressScale accessibilityRole="button" accessibilityLabel="Retry main dictation" onPress={onDictate} style={styles.speechAction}>
              <Text style={styles.speechActionText}>Retry</Text>
            </PressScale>
          ) : null}
        </View>
      ) : null}

      <View style={styles.shellWrap}>
        <GlassSurface blur blurTarget={blurTarget} variant="raised" borderRadius={radius.pill} style={[styles.shell, focused && { borderWidth: 1, borderColor: colors.gold }]} contentStyle={[styles.field, thumb.row]}>
          <PressScale
            onPressIn={() => { suppressMentionPress.current = false; }}
            onPress={insertMention}
            onLongPress={() => { suppressMentionPress.current = true; toggleHandedness(); }}
            accessibilityHint="Long press to switch thumb side"
            scaleTo={PRESS_SCALE.control}
            style={styles.sideIcon}
            accessibilityRole="button"
            accessibilityLabel="Mention"
            hitSlop={8}
          >
            <Text style={{ ...type.cardTitle, color: colors.gold }}>@</Text>
          </PressScale>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={changeValue}
            selection={cursor}
            onSelectionChange={event => {
              setSelection({ value, range: event.nativeEvent.selection });
              if (cursor) setCursor(undefined);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPressIn={() => { if (dictating) setDictating(false); }}
            showSoftInputOnFocus={!dictating}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            keyboardAppearance="dark"
            clearButtonMode="never"
            accessibilityLabel="Message"
          />
          {canSend ? (
            <Animated.View entering={popIn} exiting={popOut}>
              <PressScale
                onPress={() => {
                  const next = value.trim();
                  if (!next) return;
                  if (onSend) onSend(next);
                  else if (onClear) onClear();
                  else onChange("");
                }}
                scaleTo={PRESS_SCALE.control}
                style={styles.sendHit}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                <View style={styles.send}><Feather name="arrow-up" size={18} color={colors.onAccent} /></View>
              </PressScale>
            </Animated.View>
          ) : null}
          {/* The actual mic floats outside GlassSurface: its upward picker must not be clipped. */}
          <View pointerEvents="none" style={styles.sideIcon} />
        </GlassSurface>
        <View style={[styles.micOverlay, thumb.edge(6)]}>
          <MicButton
            side={thumb.side}
            onDictate={onDictate}
            onLive={onLive}
            onSelectLive={onLive}
            onTap={speechBusy ? onDictate : undefined}
            accessibilityLabel={speechBusy ? "Stop dictation" : undefined}
          />
        </View>
      </View>
    </View>
  );
});

export function applyScopeMention(current: string, label: string): string {
  return applyScopePrefix(current, label);
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  wrapBottom: { paddingTop: space.xs, paddingBottom: 0 },
  shellWrap: { position: "relative" },
  shell: { height: 52 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    height: 52,
  },
  sideIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  micOverlay: { position: "absolute", top: 4, zIndex: 2 },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...type.body,
    paddingVertical: 8,
    paddingHorizontal: 4,
    ...(Platform.OS === "web" ? { outlineWidth: 0 } : null),
  },
  sendHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  speechRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm },
  speechNote: { flex: 1, color: colors.textMuted, ...type.small },
  speechError: { color: colors.danger },
  speechAction: { minHeight: 44, paddingHorizontal: space.sm, justifyContent: "center" },
  speechActionText: { ...type.small, color: colors.text },
});
