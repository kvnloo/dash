import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useSharedValue } from "react-native-reanimated";
import { haptic } from "../haptics";
import { HOLD_MS } from "../lib/filter-gesture";
import {
  MENU_ROW_HEIGHT,
  rowGestureActions,
  submenuChoices,
  submenuIndex,
  type ComposerMenuRowShape,
} from "../lib/composer-row-submenu";
import { colors, glass, radius, type } from "../theme";

type Props = {
  row: ComposerMenuRowShape;
  side: "left" | "right";
  expanded: boolean;
  highlighted: boolean;
  onOpenSubmenu(): void;
  onDismissSubmenu(): void;
  onCloseMenu(): void;
};

/**
 * Each row owns its gesture stream. A short tap runs its original action.
 * Holding this row (not another one) opens a dropdown immediately below it.
 * Drag below the row and release over a choice, or lift and tap a choice.
 */
export function ComposerActionMenuRow({
  row, side, expanded, highlighted, onOpenSubmenu, onDismissSubmenu, onCloseMenu,
}: Props) {
  const choices = useMemo(() => submenuChoices(row), [row]);
  const live = useRef(rowGestureActions(row, { open: onOpenSubmenu, close: onCloseMenu }));
  live.current = rowGestureActions(row, { open: onOpenSubmenu, close: onCloseMenu });
  const [hoverChoice, setHoverChoice] = useState(-1);
  const touchedChoice = useSharedValue(-1);

  // Gesture callbacks stay stable while the parent can update models/profiles.
  const actions = useMemo(() => ({
    tap() { live.current.tap(); },
    hold() { haptic.select(); live.current.hold(); },
    choose(index: number) {
      if (live.current.choose(index)) haptic.select();
    },
    highlight(index: number) {
      setHoverChoice(index);
      if (index >= 0) haptic.select();
    },
    reset() { setHoverChoice(-1); },
  }), []);

  useEffect(() => {
    if (!expanded) setHoverChoice(-1);
  }, [expanded]);

  // The nested popup dismisses first; the enclosing ChatScreen Back handler is unchanged.
  useEffect(() => {
    if (!expanded) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onDismissSubmenu();
      return true;
    });
    return () => subscription.remove();
  }, [expanded, onDismissSubmenu]);

  const gesture = useMemo(() => {
    const hold = Gesture.Pan().activateAfterLongPress(HOLD_MS).shouldCancelWhenOutside(false)
      .onStart(() => {
        touchedChoice.value = -1;
        runOnJS(actions.hold)();
      })
      .onUpdate(event => {
        const next = submenuIndex(event.y, choices.length);
        if (next !== touchedChoice.value) {
          touchedChoice.value = next;
          runOnJS(actions.highlight)(next);
        }
      })
      .onEnd(() => {
        if (touchedChoice.value >= 0) runOnJS(actions.choose)(touchedChoice.value);
      })
      .onFinalize(() => {
        touchedChoice.value = -1;
        runOnJS(actions.reset)();
      });
    const tap = Gesture.Tap().maxDuration(HOLD_MS)
      .onEnd((_event, success) => {
        if (success) runOnJS(actions.tap)();
      });
    // A failed long-press is NOT interpreted as a tap. Only the Tap winner runs a row.
    return Gesture.Exclusive(hold, tap);
  }, [actions, choices.length, touchedChoice]);

  return <View style={[styles.anchor, expanded && styles.anchorExpanded]}>
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={row.label + ", " + row.value}
        accessibilityHint={"Tap to activate. Long press for " + row.label + " options."}
        accessibilityState={{ expanded }}
        accessibilityActions={[{ name: "activate" }, { name: "longpress" }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === "longpress") actions.hold();
          else if (event.nativeEvent.actionName === "activate") actions.tap();
        }}
        onAccessibilityTap={actions.tap}
        testID={"composer-menu-row-" + row.id}
        style={[styles.row, highlighted && styles.highlight]}
      >
        <Text style={styles.label}>{row.label}</Text>
        <Text numberOfLines={1} style={styles.value}>{row.value}</Text>
      </Animated.View>
    </GestureDetector>
    {expanded ? <View
      accessibilityLabel={row.label + " options"}
      testID={"composer-menu-submenu-" + row.id}
      style={[styles.submenu, side === "left" ? styles.right : styles.left]}
    >
      {choices.map((choice, index) => <Pressable
        key={choice.id}
        accessibilityRole="button"
        accessibilityLabel={choice.label}
        accessibilityState={{ selected: choice.selected }}
        onPress={() => actions.choose(index)}
        testID={"composer-menu-choice-" + row.id + "-" + index}
        style={[styles.choice, (hoverChoice === index || choice.selected) && styles.highlight]}
      >
        <Text numberOfLines={2} style={styles.choiceText}>{choice.label}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  anchor: { position: "relative", overflow: "visible" },
  anchorExpanded: { zIndex: 10, elevation: 16 },
  row: { minHeight: MENU_ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 12 },
  highlight: { backgroundColor: glass.fillChipOn },
  label: { ...type.small, color: colors.text },
  value: { ...type.mono, fontSize: 11, color: colors.textMuted, flex: 1, textAlign: "right" },
  submenu: {
    position: "absolute", top: "100%", width: "100%", minWidth: 228,
    borderRadius: radius.md, backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair,
    paddingVertical: 4, zIndex: 20, elevation: 20,
  },
  left: { left: 0 },
  right: { right: 0 },
  choice: { minHeight: MENU_ROW_HEIGHT, paddingHorizontal: 12, justifyContent: "center" },
  choiceText: { ...type.small, color: colors.text },
});
