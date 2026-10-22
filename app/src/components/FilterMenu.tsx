import { Feather } from "@expo/vector-icons";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  measure,
  ReduceMotion,
  runOnJS,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { haptic } from "../haptics";
import { INFO_LEVELS, LAYOUTS, LAYOUT_LABEL } from "../lib/density";
import { DWELL_MS, FORCE_ARM, HOLD_MS, IDLE, ROW_BUTTON, ROW_NONE, step, transitionHaptic, type GestureEvent, type GestureState } from "../lib/filter-gesture";
import { pageControls, rowsFor, tapIndex, type SettingRow } from "../lib/settings-registry";
import { setUiFlag, useUiFlag } from "../lib/density-store";
import { useHandedness } from "../lib/useHandedness";
import { fade, PRESS_SCALE, snappy } from "../motion";
import { colors, fonts, glass, radius, type } from "../theme";
import { useDensity } from "./Density";
import { PressScale } from "./PressScale";

export const ROW_H = 48;
const MENU_PAD = 6;
const timing = { ...snappy, reduceMotion: ReduceMotion.System };
const dwellTiming = { duration: DWELL_MS, reduceMotion: ReduceMotion.Never };
const holdTiming = { duration: HOLD_MS, reduceMotion: ReduceMotion.Never };

interface MenuShared {
  gs: SharedValue<GestureState>;
  bloom: SharedValue<number>;
  dwell: SharedValue<number>;
  hold: SharedValue<number>;
}

interface MenuApi {
  rows: SettingRow[];
  open: boolean;
  tapMode: boolean;
  armed: number;
  setOpen(open: boolean, tap: boolean): void;
  setArmed(row: number): void;
  shared: MenuShared;
  buttonRef: ReturnType<typeof useAnimatedRef<View>>;
  anchorRef: ReturnType<typeof useAnimatedRef<View>>;
}

const MenuContext = createContext<MenuApi | null>(null);

/** Info density and Layout, bound to the current density scope. Always the first two rows. */
export function useGlobalRows(): SettingRow[] {
  const { info, setInfo, layout, setLayout } = useDensity();
  return useMemo(() => [
    { id: "info", label: "Info density", kind: "scrub", home: "composer", values: INFO_LEVELS.map(l => `L${l}`), index: info - 1, select: i => setInfo(i + 1), hint: "How much data each chart shows" },
    { id: "layout", label: "Layout", kind: "scrub", home: "composer", values: LAYOUTS.map(l => LAYOUT_LABEL[l]), index: LAYOUTS.indexOf(layout), select: i => { const next = LAYOUTS[i]; if (next) setLayout(next); }, hint: "Spacing, row height, padding" },
  ], [info, layout, setInfo, setLayout]);
}

/**
 * Wraps a text bar (Dash search bar or chat composer). Renders the filter menu blooming upward
 * above the bar; `FilterButton` inside the bar drives it. `screen` picks the page rows.
 */
export function FilterMenuHost({ screen, children }: { screen: string; children: ReactNode }) {
  const global = useGlobalRows();
  const page = pageControls.use(s => s[screen]);
  const rows = useMemo(() => rowsFor("composer", global, page ?? []), [global, page]);
  const [open, setOpenState] = useState(false);
  const [tapMode, setTapMode] = useState(false);
  const [armed, setArmed] = useState(-1);
  const gs = useSharedValue<GestureState>(IDLE);
  const bloom = useSharedValue(0);
  const dwell = useSharedValue(0);
  const hold = useSharedValue(0);
  const buttonRef = useAnimatedRef<View>();
  const anchorRef = useAnimatedRef<View>();
  const setOpen = useCallback((next: boolean, tap: boolean) => {
    setOpenState(next);
    setTapMode(tap && next);
    if (!next) setArmed(-1);
    bloom.value = withTiming(next ? 1 : 0, next ? timing : { ...fade, reduceMotion: ReduceMotion.System });
  }, [bloom]);
  const api = useMemo<MenuApi>(() => ({ rows, open, tapMode, armed, setOpen, setArmed, shared: { gs, bloom, dwell, hold }, buttonRef, anchorRef }), [rows, open, tapMode, armed, setOpen, gs, bloom, dwell, hold, buttonRef, anchorRef]);
  return <MenuContext.Provider value={api}>
    <View style={styles.host}>
      <Animated.View ref={anchorRef} collapsable={false} style={styles.anchor} pointerEvents="none" />
      <FilterMenu />
      {children}
    </View>
  </MenuContext.Provider>;
}

function FilterMenu() {
  const api = useContext(MenuContext);
  const thumb = useHandedness();
  const bloomStyle = useAnimatedStyle(() => {
    const b = api?.shared.bloom.value ?? 0;
    return { opacity: b, transform: [{ translateY: (1 - b) * 24 }, { scale: 0.92 + 0.08 * b }] };
  });
  if (!api || !api.open) return null;
  const left = thumb.side !== "left";
  // Index 0 sits nearest the button; the list renders top-to-bottom, so reverse it.
  const order = api.rows.map((row, i) => ({ row, i })).reverse();
  return <>
    {api.tapMode ? <PressScale accessibilityRole="button" accessibilityLabel="Close display menu" onPress={() => api.setOpen(false, false)} style={styles.scrim} /> : null}
    <Animated.View style={[styles.menu, left ? styles.menuLeft : styles.menuRight, { transformOrigin: left ? "bottom left" : "bottom right" }, bloomStyle]} accessibilityLabel="Display menu" testID="filter-menu">
      {order.map(({ row, i }) => <MenuRow key={row.id} row={row} index={i} />)}
    </Animated.View>
  </>;
}

function MenuRow({ row, index }: { row: SettingRow; index: number }) {
  const api = useContext(MenuContext);
  const gs = api?.shared.gs;
  const dwell = api?.shared.dwell;
  const armed = api?.armed === index;
  const highlight = useAnimatedStyle(() => {
    const s = gs?.value;
    const on = s ? s.row === index && (s.phase === "hovering" || s.phase === "armed" || s.phase === "scrubbing") : false;
    return { backgroundColor: on ? glass.fillChipOn : "transparent", borderColor: on ? colors.gold : "transparent" };
  });
  const ring = useAnimatedStyle(() => {
    const s = gs?.value;
    const mine = s ? s.row === index : false;
    return { transform: [{ scale: mine ? dwell?.value ?? 0 : 0 }] };
  });
  const knob = useAnimatedStyle(() => {
    const s = gs?.value;
    const count = Math.max(1, row.values.length - 1);
    const i = s && s.row === index && (s.phase === "armed" || s.phase === "scrubbing") ? s.index : row.index;
    return { left: `${(i / count) * 100}%` };
  });
  if (!api) return null;
  const tapRow = () => {
    haptic.select();
    if (row.kind === "action") { row.run?.(); api.setOpen(false, false); return; }
    row.select(tapIndex(row));
  };
  return <Animated.View style={[styles.row, highlight]} testID={`filter-row-${row.id}`}>
    {armed && row.kind !== "action" ? <View style={styles.scrubber} accessibilityLabel={`${row.label} scrubber`}>
      <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
      <View style={styles.track}>
        {row.values.map((v, i) => <View key={v} style={[styles.tick, { left: `${(i / Math.max(1, row.values.length - 1)) * 100}%` }]} />)}
        <Animated.View style={[styles.knob, knob]} />
      </View>
      <Text style={styles.rowValue} numberOfLines={1}>{row.values[row.index]}</Text>
    </View> : <PressScale
      accessibilityRole={row.kind === "action" ? "button" : "adjustable"}
      accessibilityLabel={`${row.label}, ${row.values[row.index] ?? ""}`}
      accessibilityHint={row.hint}
      accessibilityActions={row.kind === "action" ? undefined : [{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={e => row.select(Math.max(0, Math.min(row.values.length - 1, row.index + (e.nativeEvent.actionName === "increment" ? 1 : -1))))}
      onPress={api.tapMode ? tapRow : undefined}
      style={styles.rowInner}>
      <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
      {api.tapMode && row.kind !== "action" && row.values.length > 5 ? <View style={styles.chips}>
        <PressScale accessibilityRole="button" accessibilityLabel={`${row.label} previous`} onPress={() => { haptic.select(); row.select(Math.max(0, row.index - 1)); }} scaleTo={PRESS_SCALE.control} style={styles.chip}><Text style={styles.chipText}>‹</Text></PressScale>
        <Text style={[styles.chipText, styles.chipTextOn, styles.stepValue]} numberOfLines={1}>{row.values[row.index]}</Text>
        <PressScale accessibilityRole="button" accessibilityLabel={`${row.label} next`} onPress={() => { haptic.select(); row.select(Math.min(row.values.length - 1, row.index + 1)); }} scaleTo={PRESS_SCALE.control} style={styles.chip}><Text style={styles.chipText}>›</Text></PressScale>
      </View> : api.tapMode && row.kind !== "action" ? <View style={styles.chips}>
        {row.values.map((v, i) => <PressScale key={v} accessibilityRole="button" accessibilityLabel={`${row.label} ${v}`} accessibilityState={{ selected: i === row.index }} onPress={() => { haptic.select(); row.select(i); }} scaleTo={PRESS_SCALE.control} style={[styles.chip, i === row.index && styles.chipOn]}>
          <Text style={[styles.chipText, i === row.index && styles.chipTextOn]} numberOfLines={1}>{v}</Text>
        </PressScale>)}
      </View> : <Text style={styles.rowValue} numberOfLines={1}>{row.values[row.index] ?? ""}</Text>}
      {api.tapMode ? null : <View style={styles.ringOuter}><Animated.View style={[styles.ringFill, ring]} /></View>}
    </PressScale>}
  </Animated.View>;
}

/**
 * The sliders button. Tap opens the menu for plain taps. Hold 250 ms blooms it; without lifting,
 * slide to a row, dwell 350 ms (or press hard with a stylus) to arm, move left/right to scrub,
 * release to commit. Sliding back onto the button cancels and restores the start value.
 */
export function FilterButton() {
  const api = useContext(MenuContext);
  return api ? <FilterButtonInner api={api} /> : null;
}

function FilterButtonInner({ api }: { api: MenuApi }) {
  const [hintSeen, setHintSeen] = useUiFlag("filter-hint-seen", false);
  const { gs, dwell, hold } = api.shared;
  const { buttonRef, anchorRef } = api;
  // The gesture is built once: re-creating it while a touch is down would cancel that touch.
  // Row metadata reaches the UI thread through a shared value; JS callbacks read the latest
  // rows and menu state through a ref.
  const last = useSharedValue({ x: 0, t: 0, vx: 0 });
  const meta = useSharedValue<{ counts: number[]; indices: number[]; kinds: string[] }>({ counts: [], indices: [], kinds: [] });
  const latest = useRef({ api, hintSeen, setHintSeen });
  latest.current = { api, hintSeen, setHintSeen };
  const signature = api.rows.map(r => `${r.kind}:${r.index}/${r.values.length}`).join(",");
  useEffect(() => {
    meta.value = { counts: api.rows.map(r => r.values.length), indices: api.rows.map(r => r.index), kinds: api.rows.map(r => r.kind) };
  }, [signature, meta, api.rows]);

  const js = useMemo(() => ({
    applyIndex(row: number, index: number) { latest.current.api.rows[row]?.select(index); },
    playHaptic(kind: "tick" | "arm" | "commit" | "open") {
      if (kind === "arm") haptic.arm(); else if (kind === "commit") haptic.success(); else if (kind === "open") haptic.tap(); else haptic.select();
    },
    finish(phase: GestureState["phase"], row: number, startIndex: number, index: number) {
      const { api: current } = latest.current;
      if (phase === "tapped") { haptic.select(); setUiFlag("filter-hint-seen", true); current.setOpen(!current.open, true); return; }
      const target = current.rows[row];
      if (phase === "committed") {
        if (target?.kind === "action") target.run?.();
        else if (target && index !== target.index) target.select(index);
      } else if (phase === "cancelled" && target && row >= 0 && index !== startIndex) {
        target.select(startIndex);
      }
      current.setOpen(false, false);
    },
    openFromHold() { const l = latest.current; l.api.setOpen(true, false); if (!l.hintSeen) l.setHintSeen(true); },
    arm(row: number) { latest.current.api.setArmed(row); },
  }), []);

  const gesture = useMemo(() => {
    const rowAt = (absY: number, deep: boolean): number => {
      "worklet";
      const b = measure(buttonRef);
      const a = measure(anchorRef);
      if (!b || !a) return ROW_NONE;
      if (absY >= b.pageY + (deep ? b.height / 2 : 0)) return ROW_BUTTON;
      const i = Math.floor((a.pageY - MENU_PAD - absY) / ROW_H);
      return i >= 0 && i < meta.value.counts.length ? i : ROW_NONE;
    };
    const effects = (prev: GestureState, next: GestureState) => {
      "worklet";
      const h = transitionHaptic(prev, next);
      if (h) runOnJS(js.playHaptic)(h);
      if (prev.phase === "holding" && next.phase === "open") runOnJS(js.openFromHold)();
      if (next.phase === "armed" && prev.phase === "hovering") {
        runOnJS(js.arm)(next.row);
        if (meta.value.kinds[next.row] === "action") {
          gs.value = { ...next, phase: "committed" };
          runOnJS(js.finish)("committed", next.row, next.startIndex, next.index);
          return;
        }
      }
      if ((next.phase === "scrubbing" || next.phase === "armed") && next.index !== prev.index) runOnJS(js.applyIndex)(next.row, next.index);
      if (next.phase !== prev.phase && (next.phase === "committed" || next.phase === "cancelled" || next.phase === "tapped")) {
        cancelAnimation(dwell);
        cancelAnimation(hold);
        dwell.value = 0;
        runOnJS(js.finish)(next.phase, next.row, next.startIndex, next.index);
      }
    };
    const timerDone = () => {
      "worklet";
      const prev = gs.value;
      const next = step(prev, { type: "tick", t: prev.phase === "holding" ? prev.since + HOLD_MS : prev.since + DWELL_MS });
      if (next === prev) return;
      gs.value = next;
      effects(prev, next);
    };
    const feed = (event: GestureEvent) => {
      "worklet";
      const prev = gs.value;
      let next = step(prev, event);
      if (next.phase === "hovering" && (prev.phase !== "hovering" || prev.row !== next.row)) {
        cancelAnimation(dwell);
        dwell.value = 0;
        next = step(next, { type: "rowInfo", index: meta.value.indices[next.row] ?? 0, count: meta.value.counts[next.row] ?? 1 });
        // The fill ring is the dwell timer: when it completes, the row arms with no input event.
        dwell.value = withTiming(1, dwellTiming, done => { if (done) timerDone(); });
      } else if (next.phase === "open" && prev.phase === "hovering") {
        cancelAnimation(dwell);
        dwell.value = 0;
      }
      gs.value = next;
      effects(prev, next);
    };
    const touches = Gesture.Manual()
      .shouldCancelWhenOutside(false)
      .onTouchesDown((e, manager) => {
        const t0 = e.allTouches[0];
        if (!t0 || e.numberOfTouches > 1) return;
        manager.activate();
        const now = Date.now();
        last.value = { x: t0.absoluteX, t: now, vx: 0 };
        feed({ type: "down", t: now, x: t0.absoluteX, y: t0.absoluteY });
        cancelAnimation(hold);
        hold.value = 0;
        // The hold timer is a UI-thread animation too, so a still finger still opens the menu.
        hold.value = withTiming(1, holdTiming, done => { if (done) timerDone(); });
      })
      .onTouchesMove(e => {
        const t0 = e.allTouches[0];
        if (!t0) return;
        const now = Date.now();
        const prevSample = last.value;
        const dt = Math.max(1, now - prevSample.t);
        const vx = 0.6 * prevSample.vx + 0.4 * ((t0.absoluteX - prevSample.x) / dt) * 1000;
        last.value = { x: t0.absoluteX, t: now, vx };
        const s = gs.value;
        feed({ type: "move", t: now, x: t0.absoluteX, y: t0.absoluteY, row: rowAt(t0.absoluteY, s.phase === "armed" || s.phase === "scrubbing"), vx });
      })
      .onTouchesUp((_e, manager) => { feed({ type: "up", t: Date.now() }); manager.end(); })
      .onTouchesCancelled((_e, manager) => { feed({ type: "up", t: Date.now() }); manager.end(); });
    // Pressure, where the platform reports it (stylus on Android/web); never required.
    const force = Gesture.Pan()
      .minDistance(0)
      .onUpdate(e => {
        const pressure = e.stylusData?.pressure ?? 0;
        if (pressure >= FORCE_ARM) feed({ type: "force", t: Date.now(), pressure });
      });
    return Gesture.Simultaneous(touches, force);
  }, [anchorRef, buttonRef, dwell, gs, hold, js, meta, last]);

  return <View>
    {!hintSeen ? <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>Hold · slide · pause · scrub</Text></View> : null}
    <GestureDetector gesture={gesture}>
      <Animated.View ref={buttonRef} collapsable={false} style={styles.button} accessible accessibilityRole="button" accessibilityLabel="Display filters" accessibilityHint="Tap for info density and layout. Hold and slide to scrub a setting." accessibilityState={{ expanded: api.open }} testID="filter-button">
        <Feather name="sliders" size={18} color={api.open ? colors.gold : colors.textMuted} />
      </Animated.View>
    </GestureDetector>
  </View>;
}

/** Floating variant for screens without a text bar (Trace, Lab). */
export function FloatingFilter({ screen }: { screen: string }) {
  const thumb = useHandedness();
  return <View style={[styles.floating, thumb.side === "left" ? { right: 12 } : { left: 12 }]} pointerEvents="box-none">
    <FilterMenuHost screen={screen}>
      <View style={styles.floatingPill}><FilterButton /></View>
    </FilterMenuHost>
  </View>;
}

const styles = StyleSheet.create({
  host: { position: "relative", zIndex: 1 },
  anchor: { position: "absolute", top: 0, left: 0, right: 0, height: 0 },
  scrim: { position: "absolute", left: -400, right: -400, bottom: 0, top: -2000 },
  menu: { position: "absolute", bottom: "100%", minWidth: 300, maxWidth: 380, padding: MENU_PAD, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight, zIndex: 20, elevation: 12 },
  menuLeft: { left: 12 },
  menuRight: { right: 12 },
  row: { height: ROW_H, borderRadius: radius.md, borderWidth: 1, justifyContent: "center" },
  rowInner: { flexDirection: "row", alignItems: "center", gap: 10, height: ROW_H - 2, paddingHorizontal: 12 },
  rowLabel: { ...type.label, color: colors.text, minWidth: 92 },
  rowValue: { ...type.mono, color: colors.gold, flex: 1, textAlign: "right" },
  ringOuter: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: "center", justifyContent: "center" },
  ringFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  chips: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: 2, flexWrap: "nowrap" },
  chip: { minHeight: 36, minWidth: 30, paddingHorizontal: 6, borderRadius: radius.pill, justifyContent: "center", alignItems: "center" },
  stepValue: { minWidth: 84, textAlign: "center", alignSelf: "center" },
  chipOn: { backgroundColor: glass.fillChipOn, borderWidth: 1, borderColor: colors.gold },
  chipText: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted },
  chipTextOn: { color: colors.gold },
  scrubber: { flexDirection: "row", alignItems: "center", gap: 10, height: ROW_H - 2, paddingHorizontal: 12 },
  track: { flex: 1, height: 20, justifyContent: "center", marginHorizontal: 8 },
  tick: { position: "absolute", width: 2, height: 12, marginLeft: -1, borderRadius: 1, backgroundColor: colors.textTertiary },
  knob: { position: "absolute", width: 18, height: 18, marginLeft: -9, borderRadius: 9, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.bg },
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { position: "absolute", bottom: 48, left: 0, width: 190, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: glass.fillRaised, borderWidth: 1, borderColor: glass.hair },
  hintText: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  floating: { position: "absolute", bottom: 24 },
  floatingPill: { borderRadius: radius.pill, backgroundColor: glass.fillRaised, borderWidth: 1, borderColor: glass.hair },
});
