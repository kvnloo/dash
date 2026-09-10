import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import {
  applyScopePrefix,
  filterScopeSuggestions,
  parseSearchQuery,
} from "../lib/global-search";
import { PRESS_SCALE, SNAP } from "../motion";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { fadeOut, popIn, popOut, staggerUp } from "./motion-enter";
import { PressScale } from "./PressScale";

interface Props {
  value: string;
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
  onChange,
  onScope,
  onClear,
  onVoice,
  onSend,
  placeholder = "Message Dash",
  dock = "top",
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const parsed = useMemo(() => parseSearchQuery(value), [value]);
  const suggestions = useMemo(() => filterScopeSuggestions(value), [value]);
  const composingScope = parsed.mode === "mention" || parsed.mode === "slash";
  const showScopes = focused && (composingScope || suggestions.length > 0);
  const canSend = value.trim().length > 0;

  const insertMention = () => {
    if (!value.trim()) onChange("@");
    else if (!value.startsWith("@") && !value.startsWith("/")) onChange(`@${value}`);
    inputRef.current?.focus();
  };

  return (
    <View style={[styles.wrap, dock === "bottom" && styles.wrapBottom]}>
      {showScopes && suggestions.length > 0 ? (
        <Animated.View
          style={styles.suggestions}
          accessibilityRole="list"
          layout={LinearTransition.springify().mass(SNAP.mass).stiffness(SNAP.stiffness).damping(SNAP.damping)}
        >
          {suggestions.map(({ label }, i) => (
            <Animated.View key={label} entering={staggerUp(i)} exiting={fadeOut}>
              <PressScale
                onPress={() => onScope(label)}
                scaleTo={PRESS_SCALE.control}
                accessibilityRole="button"
              >
                <GlassSurface variant="raised" blur={false} borderRadius={radius.lg} style={styles.suggestion}>
                  <Text style={styles.suggestionText}>{label}</Text>
                </GlassSurface>
              </PressScale>
            </Animated.View>
          ))}
        </Animated.View>
      ) : null}

      <GlassSurface borderRadius={radius.pill} style={styles.shell} contentStyle={styles.field}>
        <PressScale
          onPress={insertMention}
          scaleTo={PRESS_SCALE.control}
          style={styles.sideIcon}
          accessibilityRole="button"
          accessibilityLabel="Mention"
          hitSlop={8}
        >
          <Ionicons name="add" size={22} color={colors.textMuted} />
        </PressScale>
        <TextInput
          ref={inputRef}
          value={value}
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
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </PressScale>
          </Animated.View>
        ) : (
          <PressScale
            onPress={onVoice}
            scaleTo={PRESS_SCALE.control}
            style={styles.sideIcon}
            accessibilityRole="button"
            accessibilityLabel="Voice input"
            hitSlop={8}
          >
            <Ionicons name="mic-outline" size={22} color={colors.textMuted} />
          </PressScale>
        )}
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
  shell: { minHeight: 48 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 48,
  },
  sideIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    color: colors.text,
    ...type.body,
    paddingVertical: 8,
    paddingHorizontal: 4,
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
  suggestion: { paddingHorizontal: space.md, paddingVertical: 8 },
  suggestionText: { color: colors.text, ...type.small, textTransform: "none", letterSpacing: 0, fontWeight: "600" },
});
