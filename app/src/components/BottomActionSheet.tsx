import { useCallback, useEffect, useRef } from "react";
import { Feather } from "@expo/vector-icons";
import {
  AccessibilityInfo, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, View, findNodeHandle, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from "react-native-reanimated";
import {
  SHEET_HEADER_HEIGHT, SHEET_ROW_HEIGHT, createSheetInteraction, sheetA11y, sheetLayout,
  type BottomActionOption,
} from "../lib/bottom-action-sheet";
import { colors, easing, glass, radius, space, timing, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

export interface BottomActionSheetProps {
  open: boolean;
  title?: string;
  options: BottomActionOption[];
  onSelect(id: string): void;
  onClose(): void;
}

/** Generic, bottom-anchored row actions. Long-press hosts remain responsible for opening it. */
export function BottomActionSheet({ open, title, options, onSelect, onClose }: BottomActionSheetProps) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, space.md);
  const layout = sheetLayout(options.length, window.height, bottomInset);
  const rows = sheetA11y(options);
  const headingRef = useRef<Text>(null);
  const interaction = useRef(createSheetInteraction(open)).current;
  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  // A selection consumes this opening synchronously, even during two rapid taps.
  useEffect(() => {
    interaction.setOpen(open);
  }, [open, interaction]);

  useEffect(() => {
    if (!open) {
      progress.value = 0;
      return;
    }
    if (reducedMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: timing.state,
      easing: Easing.bezier(...easing.sheet),
      reduceMotion: ReduceMotion.System,
    });
  }, [open, reducedMotion, progress]);

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 0 : (1 - progress.value) * layout.height }],
  }));

  const dismiss = useCallback(() => {
    interaction.dismiss(onClose);
  }, [interaction, onClose]);

  const choose = useCallback((id: string) => {
    interaction.choose(id, options, onSelect, onClose, Platform.OS === "ios");
  }, [interaction, onSelect, onClose, options]);

  const flushPendingSelection = useCallback(() => {
    interaction.didDismiss();
  }, [interaction]);

  const focusHeading = useCallback(() => {
    if (Platform.OS === "web") return;
    const target = findNodeHandle(headingRef.current);
    if (target !== null) AccessibilityInfo.setAccessibilityFocus(target);
  }, []);

  return <Modal
    visible={open}
    transparent
    animationType="none"
    statusBarTranslucent
    navigationBarTranslucent
    onRequestClose={dismiss}
    onShow={focusHeading}
    onDismiss={flushPendingSelection}
  >
    <View style={styles.overlay}>
      <Pressable
        testID="bottom-action-sheet-backdrop"
        style={styles.scrim}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={dismiss}
      />
      <Animated.View style={[styles.animatedSheet, { height: layout.height }, slideStyle]}>
        <GlassSurface
          testID="bottom-action-sheet"
          variant="raised"
          borderRadius={radius.lg}
          accessibilityLabel={title || "Actions"}
          accessibilityViewIsModal
          onAccessibilityEscape={dismiss}
          style={styles.surface}
          contentStyle={styles.content}
        >
          <ScrollView
            style={styles.list}
            scrollEnabled={layout.scrollable}
            keyboardShouldPersistTaps="always"
            nestedScrollEnabled
            showsVerticalScrollIndicator={layout.scrollable}
          >
            <View style={styles.header}>
              <View style={styles.handle} accessible={false} />
              <View style={styles.headerRow}>
                <Text
                  ref={headingRef}
                  accessibilityRole="header"
                  numberOfLines={1}
                  style={styles.title}
                >{title || "Actions"}</Text>
                <Pressable
                  testID="bottom-action-sheet-close"
                  accessibilityRole="button"
                  accessibilityLabel="Close actions"
                  onPress={dismiss}
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                >
                  <Feather name="x" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>
            {rows.map(row => <Pressable
              key={row.id}
              testID={`bottom-action-sheet-option-${row.id}`}
              accessibilityRole="button"
              accessibilityLabel={row.accessibilityLabel}
              accessibilityHint={row.accessibilityHint}
              onPress={() => choose(row.id)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={[styles.optionText, row.destructive && styles.destructive]}>
                {row.label}
              </Text>
            </Pressable>)}
            <View style={{ height: bottomInset }} accessible={false} />
          </ScrollView>
        </GlassSurface>
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.64)" },
  animatedSheet: { width: "100%" },
  surface: { flex: 1, backgroundColor: colors.surfaceRaised },
  content: { flex: 1 },
  header: { height: SHEET_HEADER_HEIGHT, flexShrink: 0 },
  handle: {
    position: "absolute", alignSelf: "center", top: 6,
    width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.textMuted,
  },
  headerRow: {
    height: 44, marginTop: 12, paddingLeft: space.lg, paddingRight: space.sm,
    flexDirection: "row", alignItems: "center",
  },
  title: { ...type.heading, color: colors.text, flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  list: { flex: 1, minHeight: 0 },
  option: {
    height: SHEET_ROW_HEIGHT, flexDirection: "row", alignItems: "center",
    paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.hair,
  },
  pressed: { backgroundColor: glass.fillChipOn },
  optionText: { ...type.body, color: colors.text, flexShrink: 1 },
  destructive: { color: colors.danger },
});
