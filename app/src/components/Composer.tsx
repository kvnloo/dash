import { Ionicons } from "@expo/vector-icons";
import { memo, useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

interface Props {
  disabled: boolean;
  streaming: boolean;
  placeholder: string;
  initialText?: string;
  onSend(text: string): void;
  onStop(): void;
}

export const Composer = memo(function Composer({ disabled, streaming, placeholder, initialText, onSend, onStop }: Props) {
  const [text, setText] = useState(initialText ?? "");
  const canSend = text.trim().length > 0 && !disabled;

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    onSend(value);
  }, [text, disabled, onSend]);

  return (
    <View style={styles.wrap}>
      <GlassSurface borderRadius={radius.lg + 4} style={styles.field}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          multiline
          keyboardAppearance="dark"
          autoCapitalize="sentences"
          autoCorrect
          // Enter sends on web/desktop keyboards; on phones Enter inserts a newline.
          blurOnSubmit={false}
          onSubmitEditing={Platform.OS === "web" ? submit : undefined}
          submitBehavior={Platform.OS === "web" ? "submit" : "newline"}
          accessibilityLabel="Message"
        />
        {streaming ? (
          <View style={styles.streamingActions}>
            <Pressable
              onPress={onStop}
              style={({ pressed }) => [styles.button, styles.stop, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Stop"
              hitSlop={8}
            >
              <View style={styles.stopSquare} />
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!canSend}
              style={({ pressed }) => [styles.button, !canSend && styles.buttonDisabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={canSend ? "Queue message" : "Send"}
              hitSlop={8}
            >
              <Ionicons name="arrow-up" size={20} color={canSend ? colors.onAccent : colors.textFaint} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canSend}
            style={({ pressed }) => [styles.button, !canSend && styles.buttonDisabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={8}
          >
            <Ionicons name="arrow-up" size={20} color={canSend ? colors.onAccent : colors.textFaint} />
          </Pressable>
        )}
      </GlassSurface>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: colors.bg },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 48,
  },
  input: {
    flex: 1,
    color: colors.text,
    ...type.body,
    maxHeight: 6 * 24,
    paddingTop: Platform.OS === "ios" ? 6 : 4,
    paddingBottom: Platform.OS === "ios" ? 6 : 4,
    paddingRight: 8,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  buttonDisabled: { backgroundColor: colors.surfaceRaised },
  streamingActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  stop: { backgroundColor: colors.accent },
  stopSquare: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.onAccent },
  pressed: { opacity: 0.7 },
});
