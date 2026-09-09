import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  applyScopePrefix,
  filterScopeSuggestions,
  MENTION_SCOPES,
  parseSearchQuery,
  SLASH_SCOPES,
} from "../lib/global-search";
import { GlassSurface } from "./GlassSurface";
import { colors, radius, space, type } from "../theme";

interface Props {
  value: string;
  onChange(value: string): void;
  onScope(label: string): void;
  onClear?(): void;
  /** Bottom dock on main screen — chips expand upward. */
  dock?: "top" | "bottom";
}

export const GlobalSearchBar = memo(function GlobalSearchBar({ value, onChange, onScope, onClear, dock = "top" }: Props) {
  const [focused, setFocused] = useState(false);
  const parsed = useMemo(() => parseSearchQuery(value), [value]);
  const suggestions = useMemo(() => filterScopeSuggestions(value), [value]);
  const showScopes = focused;

  const activeMention =
    parsed.mode === "mention" && parsed.scope !== "unknown" ? parsed.scope : null;
  const activeSlash = parsed.mode === "slash" && parsed.scope !== "unknown" ? parsed.scope : null;

  return (
    <View style={[styles.wrap, dock === "bottom" && styles.wrapBottom]}>
      <GlassSurface borderRadius={radius.lg} style={styles.field}>
        <Ionicons name="at" size={18} color={colors.textMuted} style={styles.icon} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="@bots, @conversation, /file…"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
        />
        {value.length > 0 ? (
          <Pressable
            onPress={() => (onClear ? onClear() : onChange(""))}
            hitSlop={8}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </GlassSurface>

      {showScopes && suggestions.length > 0 ? (
        <View style={styles.suggestions} accessibilityRole="list">
          {suggestions.map(({ label }) => (
            <Pressable
              key={label}
              onPress={() => onScope(label)}
              style={({ pressed }) => [pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <GlassSurface variant="raised" blur={false} borderRadius={radius.lg} style={styles.suggestion}>
                <Text style={styles.suggestionText}>{label}</Text>
              </GlassSurface>
            </Pressable>
          ))}
        </View>
      ) : null}

      {showScopes ? (
        <>
          <View style={styles.chipSection}>
            <Text style={styles.chipHeading}>On phone</Text>
            <View style={styles.chips}>
              {MENTION_SCOPES.map(({ scope, label }) => {
                const on = activeMention === scope;
                return (
                  <Pressable
                    key={scope}
                    onPress={() => onScope(label)}
                    style={({ pressed }) => [pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <GlassSurface
                      variant={on ? "chipOn" : "chip"}
                      blur={false}
                      borderRadius={radius.pill}
                      style={styles.chip}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                    </GlassSurface>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.chipSection}>
            <Text style={styles.chipHeading}>On laptop</Text>
            <View style={styles.chips}>
              {SLASH_SCOPES.map(({ scope, label }) => {
                const on = activeSlash === scope;
                return (
                  <Pressable
                    key={scope}
                    onPress={() => onScope(label)}
                    style={({ pressed }) => [pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <GlassSurface
                      variant={on ? "chipOn" : "chip"}
                      blur={false}
                      borderRadius={radius.pill}
                      style={styles.chip}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                    </GlassSurface>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
});

export function applyScopeMention(current: string, label: string): string {
  return applyScopePrefix(current, label);
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm },
  wrapBottom: { paddingTop: space.xs, paddingBottom: 0 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  icon: { marginRight: space.sm },
  input: { flex: 1, color: colors.text, ...type.body, paddingVertical: space.sm },
  clear: { padding: space.xs },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  suggestion: { paddingHorizontal: space.md, paddingVertical: 8 },
  suggestionText: { color: colors.text, ...type.small, textTransform: "none", letterSpacing: 0, fontWeight: "600" },
  chipSection: { gap: 6 },
  chipHeading: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: 6 },
  chipText: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0 },
  chipTextOn: { color: colors.text },
  pressed: { opacity: 0.85 },
});
