import { useHandedness } from "../lib/useHandedness";
import { MicButton } from "./MicButton";
import { dictate } from "../lib/dictation";
import { insertAtCursor, type Selection } from "../lib/mic-gesture";
import { Feather } from "@expo/vector-icons";
import { type RefObject, memo, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { applyScopePrefix } from "../lib/global-search";
import { PRESS_SCALE } from "../motion";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { fadeOut, popIn, popOut, staggerUp } from "./motion-enter";
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
  const selection = useRef<Selection | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [dictating, setDictating] = useState(false);
  const [cursor, setCursor] = useState<Selection>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const onDictate = async () => {
    if (pending.current) return;
    pending.current = true;
    const at = selection.current;
    setDictating(true); Keyboard.dismiss();
    const result = await dictate();
    pending.current = false;
    if (!mounted.current) return;
    if (result.ok) {
      const next = insertAtCursor(value, at, result.text);
      onChange(next.text);
      const sel = { start: next.cursor, end: next.cursor };
      selection.current = sel; setCursor(sel);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (result.reason !== "canceled") Alert.alert("Dictation", result.message ?? "System speech recognizer unavailable.");
  };
  const [focused, setFocused] = useState(false);
  const canSend = value.trim().length > 0;

  const insertMention = () => {
    if (!value.trim()) onChange("@");
    else if (!value.startsWith("@") && !value.startsWith("/")) onChange(`@${value}`);
    inputRef.current?.focus();
  };

  return (
    <View style={[styles.wrap, dock === "bottom" && styles.wrapBottom]}>
      <ComposerSuggestions text={value} onChange={onChange} />

      <GlassSurface blur blurTarget={blurTarget} variant="raised" borderRadius={radius.pill} style={[styles.shell, focused && { borderWidth: 1, borderColor: colors.gold }]} contentStyle={[styles.field, thumb.row]}>
        <PressScale
          onPress={insertMention}
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
          selection={cursor}
          onSelectionChange={e => { selection.current = e.nativeEvent.selection; if (cursor) setCursor(undefined); }}
          showSoftInputOnFocus={!dictating}
          onPressIn={() => setDictating(false)}
          multiline
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
              style={styles.send}
              accessibilityRole="button"
              accessibilityLabel="Send"
              hitSlop={8}
            >
              <Feather name="arrow-up" size={18} color={colors.onAccent} />
            </PressScale>
          </Animated.View>
        ) : null}
        <MicButton side={thumb.side} onDictate={onDictate} onLive={() => onVoice?.()} />
      </GlassSurface>
    </View>
  );
});

export function applyScopeMention(current: string, label: string): string {
  return applyScopePrefix(current, label);
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  wrapBottom: { paddingTop: space.xs, paddingBottom: 0 },
  shell: { minHeight: 52 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  sideIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minWidth: 0,
    maxHeight: 148,
    color: colors.text,
    ...type.body,
    paddingVertical: 8,
    paddingHorizontal: 4,
    ...(Platform.OS === "web" ? { outlineWidth: 0 } : null),
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  suggestion: { paddingHorizontal: space.md, paddingVertical: 12 },
  suggestionText: { color: colors.text, ...type.small, textTransform: "none", letterSpacing: 0, fontWeight: "600" },
});
