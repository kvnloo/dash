import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { DWELL_MS, FORCE_ARM, HOLD_MS, scrubIndex } from "../lib/filter-gesture";
import { useHandedness } from "../lib/useHandedness";
import { ComposerActionMenuRow } from "./ComposerActionMenuRow";
import type { ComposerMenuRowShape } from "../lib/composer-row-submenu";
import { haptic } from "../haptics";
import { fade, snappy } from "../motion";
import { colors, glass, radius } from "../theme";

export type ComposerMenuRow = ComposerMenuRowShape;
/** Neutral composer menu primitive. Filter and agent hosts can supply the same row contract. */
export function ComposerActionMenu({ label, children, rows, open: controlled, onOpenChange, testID }: {
  label: string; children: ReactNode; rows: ComposerMenuRow[];
  /** Optional controlled state so a host can close the menu on Android Back. */
  open?: boolean; onOpenChange?(open: boolean): void; testID?: string;
}) {
  const thumb = useHandedness();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const change = useRef(onOpenChange); change.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => { setUncontrolled(next); change.current?.(next); }, []);
  const [hover, setHover] = useState(-1);
  const [submenuRow, setSubmenuRow] = useState<string | null>(null);
  const closeMenu = useCallback(() => { setSubmenuRow(null); setHover(-1); setOpen(false); }, [setOpen]);
  useEffect(() => { if (!open) setSubmenuRow(null); }, [open]);
  const bloom = useSharedValue(0);
  const row = useSharedValue(-1);
  const armed = useSharedValue(false);
  const dwell = useSharedValue(0);
  const startX = useSharedValue(0);
  const selection = useSharedValue(0);
  const meta = useSharedValue<{ count: number; values: number[]; indices: number[] }>({ count: 0, values: [], indices: [] });
  const latest = useRef({ rows, open }); latest.current = { rows, open };
  useEffect(() => { meta.value = { count: rows.length, values: rows.map(r => r.values?.length ?? 1), indices: rows.map(r => r.index ?? 0) }; }, [rows, meta]);
  useEffect(() => { bloom.value = withTiming(open ? 1 : 0, { ...(open ? snappy : fade), reduceMotion: ReduceMotion.System }); }, [open, bloom]);
  const style = useAnimatedStyle(() => ({ opacity: bloom.value, transform: [{ translateY: (1 - bloom.value) * 12 }] }));
  const actions = useMemo(() => ({
    open() { haptic.tap(); setOpen(true); },
    toggle() { haptic.tap(); setOpen(!latest.current.open); },
    hover(index: number) { haptic.select(); setHover(index); },
    arm() { haptic.select(); },
    finish(index: number, selected: number, commit: boolean) {
      const target = latest.current.rows[index];
      if (commit && target) { haptic.select(); if (target.values?.length && target.inspect) target.inspect(selected); else target.run(); }
      setOpen(false); setHover(-1);
    },
  }), [setOpen]);
  const gesture = useMemo(() => {
    const hold = Gesture.Pan().activateAfterLongPress(HOLD_MS).shouldCancelWhenOutside(false)
      .onStart(() => { row.value = -1; armed.value = false; runOnJS(actions.open)(); })
      .onUpdate(e => {
        // Row zero is nearest the button, matching the filter menu's bottom-up order.
        const next = e.translationY >= -4 ? -1 : Math.floor((-e.translationY - 4) / 48);
        if (next !== row.value && !armed.value) {
          cancelAnimation(dwell); dwell.value = 0;
          row.value = next >= 0 && next < meta.value.count ? next : -1;
          startX.value = e.translationX;
          selection.value = meta.value.indices[row.value] ?? 0;
          runOnJS(actions.hover)(row.value);
          if (row.value >= 0) dwell.value = withTiming(1, { duration: DWELL_MS, reduceMotion: ReduceMotion.Never }, done => { if (done) { armed.value = true; runOnJS(actions.arm)(); } });
        }
        if (row.value >= 0 && e.stylusData && e.stylusData.pressure >= FORCE_ARM) armed.value = true;
        if (armed.value && row.value >= 0) selection.value = scrubIndex(meta.value.indices[row.value] ?? 0, e.translationX - startX.value, meta.value.values[row.value] ?? 1, e.velocityX);
        if (e.translationY >= -4) { cancelAnimation(dwell); armed.value = false; row.value = -1; }
      })
      .onEnd(() => { cancelAnimation(dwell); runOnJS(actions.finish)(row.value, selection.value, row.value >= 0 && armed.value); })
      .onFinalize((_e, success) => { if (!success) { cancelAnimation(dwell); runOnJS(actions.finish)(-1, 0, false); } });
    return Gesture.Exclusive(hold, Gesture.Tap().maxDuration(HOLD_MS).onEnd((_e, ok) => { if (ok) runOnJS(actions.toggle)(); }));
  }, [actions, armed, dwell, meta, row, selection, startX]);
  return <View style={styles.host} testID={testID}>
    {open ? <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={closeMenu} style={styles.scrim} />
      <Animated.View style={[styles.menu, thumb.side === "left" ? styles.right : styles.left, style]} accessibilityLabel={label}>
        {rows.map((r, index) => ({ r, index })).reverse().map(({ r, index }) => <ComposerActionMenuRow
          key={r.id}
          row={r}
          side={thumb.side}
          expanded={submenuRow === r.id}
          highlighted={hover === index}
          onOpenSubmenu={() => setSubmenuRow(r.id)}
          onDismissSubmenu={() => setSubmenuRow(null)}
          onCloseMenu={closeMenu}
        />)}
      </Animated.View>
    </> : null}
    <GestureDetector gesture={gesture}><Animated.View accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Tap to open. Hold, slide to a row, pause, then release." accessibilityState={{ expanded: open }} onAccessibilityTap={actions.toggle} style={styles.button}>{children}</Animated.View></GestureDetector>
  </View>;
}
const styles = StyleSheet.create({
  host: { position: "relative", zIndex: 20 }, button: { minWidth: 44, minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  scrim: { position: "absolute", top: -1800, bottom: 0, left: -600, right: -600 },
  menu: { position: "absolute", bottom: "100%", width: 300, overflow: "visible", borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: glass.hair, elevation: 12 }, left: { left: 0 }, right: { right: 0 },
});
