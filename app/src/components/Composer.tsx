import { Ionicons } from "@expo/vector-icons";
import { memo, useCallback, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { PRESS_SCALE } from "../motion";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { popIn, popOut } from "./motion-enter";
import { PressScale } from "./PressScale";

interface Props {
  disabled: boolean;
  streaming: boolean;
  placeholder: string;
  initialText?: string;
  onSend(text: string): void;
  onStop(): void;
  onVoice(): void;
}

export const Composer = memo(function Composer({
  disabled,
  streaming,
  placeholder,
  initialText,
  onSend,
  onStop,
  onVoice,
}: Props) {
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
      <GlassSurface borderRadius={radius.pill} style={styles.shell} contentStyle={styles.field}>
        <PressScale
          scaleTo={PRESS_SCALE.control}
          style={styles.sideIcon}
          accessibilityRole="button"
          accessibilityLabel="Attach"
          hitSlop={8}
        >
          <Ionicons name="add" size={22} color={colors.textMuted} />
        </PressScale>
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
            <PressScale
              onPress={onStop}
              scaleTo={PRESS_SCALE.control}
              style={[styles.button, styles.stop]}
              accessibilityRole="button"
              accessibilityLabel="Stop"
              hitSlop={8}
            >
              <View style={styles.stopSquare} />
            </PressScale>
            <PressScale
              onPress={submit}
              disabled={!canSend}
              scaleTo={PRESS_SCALE.control}
              style={[styles.button, !canSend && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={canSend ? "Queue message" : "Send"}
              hitSlop={8}
            >
              <Ionicons name="arrow-up" size={20} color={canSend ? colors.onAccent : colors.textFaint} />
            </PressScale>
          </View>
        ) : canSend ? (
          <Animated.View entering={popIn} exiting={popOut}>
            <PressScale
              onPress={submit}
              scaleTo={PRESS_SCALE.control}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel="Send"
              hitSlop={8}
            >
              <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
            </PressScale>
          </Animated.View>
        ) : (
          <PressScale
            scaleTo={PRESS_SCALE.control}
            style={styles.sideIcon}
            accessibilityRole="button"
            accessibilityLabel="Voice input"
            hitSlop={8}
            onPress={onVoice}
          >
            <Ionicons name="mic-outline" size={22} color={colors.textMuted} />
          </PressScale>
        )}
      </GlassSurface>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: colors.bg },
  shell: { minHeight: 48 },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
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
    marginBottom: 0,
  },
  input: {
    flex: 1,
    color: colors.text,
    ...type.body,
    maxHeight: 6 * 24,
    paddingTop: Platform.OS === "ios" ? 6 : 4,
    paddingBottom: Platform.OS === "ios" ? 6 : 4,
    paddingLeft: 10,
    paddingRight: 8,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
  },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  buttonDisabled: { backgroundColor: colors.surfaceRaised },
  streamingActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  stop: { backgroundColor: colors.accent },
  stopSquare: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.onAccent },
});
