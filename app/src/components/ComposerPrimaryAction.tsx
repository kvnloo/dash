import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../theme";
import {
  activateComposerPrimaryAction,
  selectComposerPrimaryAction,
  type ComposerPrimaryInput,
} from "../lib/composer-primary-action";
import { PressScale } from "./PressScale";

interface Props extends ComposerPrimaryInput {
  onSubmit(): void;
  onStop(): void;
}

/**
 * Exactly one accessible primary target near the text input.
 * Keep this the first child of the left-aligned composer-controls row.
 * Hermes owns the Composer.tsx wiring.
 */
export function ComposerPrimaryAction({
  editingQueue,
  streaming,
  steerBusy,
  canSend,
  sendMode,
  onSubmit,
  onStop,
}: Props) {
  const action = selectComposerPrimaryAction({
    editingQueue,
    streaming,
    steerBusy,
    canSend,
    sendMode,
  });

  return (
    <PressScale
      testID="composer-primary-action"
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityHint={action.hint}
      accessibilityState={{ disabled: action.disabled }}
      disabled={action.disabled}
      onPress={() => { activateComposerPrimaryAction(action, onSubmit, onStop); }}
      style={[styles.hit, action.kind === "save-queue" && styles.saveQueue]}
    >
      {action.kind === "save-queue" ? (
        <Text allowFontScaling style={styles.saveText}>Save queued</Text>
      ) : (
        <View style={[
          styles.circle,
          action.kind === "stop" && styles.stopCircle,
          action.disabled && styles.disabledCircle,
        ]}>
          {action.kind === "stop" ? (
            <View style={styles.square} />
          ) : (
            <Feather name={action.glyph} size={20} color={colors.onAccent} />
          )}
        </View>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  saveQueue: { width: 100 },
  saveText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: colors.text },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  stopCircle: { backgroundColor: colors.text },
  disabledCircle: { opacity: 0.3 },
  square: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.bg },
});
