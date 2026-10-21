import { DensityText as Text, DensityAnimatedText } from "../Density";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { snappy, settle as release, fade, settleTiming } from "../../motion";
import { haptic } from "../../haptics";
import {
  GROUP_LABEL, ZOOM_MAX, askWord, ZOOM_MIN, activeAt, clock, dur, hourStep, initialZoom, packLanes, panBounds, rowMeta,
  scrubTick, softClamp, softZoom, summarizeRow, timeAtX, txForTime, zoomAround,
  type RowGroup, type TraceRow, type TraceSnapshot, type TraceWorker,
} from "../../trace/model";
import { useDensity } from "../Density";
import { InteractiveTile } from "../InteractiveTile";
import { PressScale } from "../PressScale";
import { colors, fonts, radius, space, type } from "../../theme";
import { LivePulse, tc } from "./tokens";

export type RowVariant = "bars" | "density" | "compact";
export type RowRect = { x: number; y: number; width: number; height: number };
export type ScrubState = { t: number; label: string; live: number } | null;

/** A ref the timeline's scrub and pinch take priority over (the screen's ScrollView). */
export type ExternalGesture = Parameters<ReturnType<typeof Gesture.Pan>["blocksExternalGesture"]>[0];

const settle = { ...release, reduceMotion: ReduceMotion.System };
const SCRUB_STEP_S = 900;
const LABEL_FRAC = 0.32;
/** "now" sits at this fraction of the plot on open, leaving room for the live notes after it. */
const OPEN_FRAC = 0.72;

type Item =
  | { kind: "axis"; h: number }
  | { kind: "lane"; lane: "cuts" | "you"; h: number }
  | { kind: "group"; group: RowGroup; n: number; h: number }
  | { kind: "row"; row: TraceRow; lanes: number[]; nLanes: number; h: number; index: number };

function rowHeight(variant: RowVariant, nLanes: number): number {
  if (variant === "compact") return Math.max(40, 22 + nLanes * 6);
  if (variant === "density") return 52;
  return Math.max(56, 30 + nLanes * 12);
}

export function buildItems(rows: TraceRow[], variant: RowVariant, opts: { lanes: boolean; groups: boolean; minHeight?: number }): Item[] {
  const items: Item[] = [{ kind: "axis", h: 34 }];
  if (opts.lanes) items.push({ kind: "lane", lane: "cuts", h: 22 }, { kind: "lane", lane: "you", h: 22 });
  let g: RowGroup | null = null;
  rows.forEach((row, index) => {
    if (opts.groups && row.group !== g) {
      g = row.group;
      items.push({ kind: "group", group: g, n: rows.filter((r) => r.group === g).length, h: 34 });
    }
    const lanes = packLanes(row.workers);
    const nLanes = Math.max(...lanes) + 1;
    items.push({ kind: "row", row, lanes, nLanes, h: Math.max(opts.minHeight ?? 0, rowHeight(variant, nLanes)), index });
  });
  return items;
}

/**
 * Native trace timeline: label column on the left, a pannable / pinchable plot on the right.
 *  - pan: bounded velocity settle; cancel immediately on the next drag
 *  - pinch: zoom around the focal point, 1× (fit) to 24×, rubber band past the limits
 *  - long-press a ROW: a dropdown of that row's actions opens under it; keep holding, slide to an action, release to run it
 *    (or lift and tap). Long-press empty plot (axis/lanes): scrub the playhead with a haptic tick every 15 min
 *  - tap a row (label or plot): onOpenRow with the row's window rect for the expand
 */
export const TraceTimeline = memo(function TraceTimeline({
  snapshot, rows, variant = "bars", lanes = true, groups = true, onOpenRow, onScrub, scrollRef, selectedKey, testID = "trace-timeline",
}: {
  snapshot: TraceSnapshot;
  rows: TraceRow[];
  variant?: RowVariant;
  lanes?: boolean;
  groups?: boolean;
  onOpenRow?(row: TraceRow, rect: RowRect): void;
  onScrub?(s: ScrubState): void;
  scrollRef?: ExternalGesture;
  selectedKey?: string | null;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const { sizing, fontScale } = useDensity();
  const minRowHeight = Math.max(sizing.rowMin, Math.ceil(52 * fontScale));
  const span = snapshot.now + 40 * 60;
  const items = useMemo(() => buildItems(rows, variant, { lanes, groups, minHeight: minRowHeight }), [rows, variant, lanes, groups, minRowHeight]);
  const offsets = useMemo(() => { let y = 0; return items.map((it) => { const o = y; y += it.h; return o; }); }, [items]);
  const maxDensity = useMemo(() => Math.max(1, ...rows.flatMap((r) => r.workers.flatMap((w) => w.density))), [rows]);
  const cutTimes = useMemo(() => rows.flatMap((r) => r.workers.filter((w) => w.status === "interrupted").map((w) => w.e)), [rows]);

  const [plotW, setPlotW] = useState(0);
  const viewW = useSharedValue(0);
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const pressedRow = useSharedValue(-1);
  const scrubX = useSharedValue(0);
  const scrubOn = useSharedValue(0);
  const [scrub, setScrub] = useState<ScrubState>(null);
  const wrapRef = useRef<View>(null);
  const labelRefs = useRef(new Map<string, View | null>());

  const onPlotLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - viewW.value) < 1) return;
    const previousWidth = viewW.value;
    const first = previousWidth === 0;
    viewW.value = w;
    setPlotW(w);
    if (first) {
      const z = initialZoom(span);
      zoom.value = z;
      tx.value = txForTime(snapshot.now, span, w, z, OPEN_FRAC);
    } else {
      const [lo, hi] = panBounds(w * zoom.value, w);
      tx.value = Math.min(hi, Math.max(lo, tx.value * w / previousWidth));
    }
  };

  /* ---- JS-side callbacks ---- */
  const scrubTo = useCallback((t: number, hour: boolean, first: boolean) => {
    if (first) haptic.tap(); else if (hour) haptic.tap(); else haptic.select();
    const snapped = Math.round(t / 60) * 60;
    const s: ScrubState = { t: snapped, label: clock(snapshot.t0, snapped), live: activeAt(rows, snapped) };
    setScrub(s);
    onScrub?.(s);
  }, [onScrub, rows, snapshot.t0]);
  const scrubEnd = useCallback(() => { setScrub(null); onScrub?.(null); }, [onScrub]);


  const openIndex = useCallback((itemIndex: number) => {
    const it = items[itemIndex];
    if (!it || it.kind !== "row" || !onOpenRow) return;
    haptic.select();
    const ref = labelRefs.current.get(it.row.key);
    const wrap = wrapRef.current;
    if (!ref || !wrap) { onOpenRow(it.row, { x: 0, y: 0, width: 0, height: 0 }); return; }
    wrap.measureInWindow((wx, _wy, ww) => {
      ref.measureInWindow((_x, y, _w, h) => onOpenRow(it.row, { x: wx, y, width: ww, height: h }));
    });
  }, [items, onOpenRow]);

  /* ---- row menu: actions belong to the pressed row, never the whole page ---- */
  const [menu, setMenu] = useState<{ item: number; top: number } | null>(null);
  const [hovered, setHovered] = useState(-1);
  const menuItem = useRef(-1);
  const menuMode = useSharedValue(0);
  const menuTop = useSharedValue(0);
  const hoverIdx = useSharedValue(-1);
  const MENU_ROW_H = 44;
  const zoomToRow = useCallback((itemIndex: number) => {
    const it = items[itemIndex];
    const w = viewW.value;
    if (!it || it.kind !== "row" || !w) return;
    const { s: start, e: end } = summarizeRow(it.row);
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (span / Math.max(60, end - start)) * 0.8));
    zoom.value = withTiming(z, { ...snappy, reduceMotion: ReduceMotion.System });
    const mid = (start + end) / 2;
    tx.value = withTiming(txForTime(mid, span, w, z, 0.5), { ...snappy, reduceMotion: ReduceMotion.System });
  }, [items, span, tx, viewW, zoom]);
  const rowActions = useMemo(() => [
    { id: "open", label: "Open details", hint: "tap" },
    { id: "zoom", label: "Zoom to this run", hint: "time" },
    { id: "copy", label: "Copy summary", hint: "clip" },
  ] as const, []);
  const runAction = useCallback((itemArg: number, actionIndex: number) => {
    const itemIndex = itemArg >= 0 ? itemArg : menuItem.current;
    const it = items[itemIndex];
    const action = rowActions[actionIndex];
    setMenu(null); setHovered(-1);
    if (!it || it.kind !== "row" || !action) return;
    haptic.tap();
    if (action.id === "open") openIndex(itemIndex);
    else if (action.id === "zoom") zoomToRow(itemIndex);
    else {
      const m = summarizeRow(it.row);
      void Clipboard.setStringAsync(`${it.row.project} · ${it.row.goal}\n${m.workers} workers · ${m.calls} calls · ${m.errors} errors${m.cut ? ` · ${m.cut} cut` : ""}${m.live ? " · live" : ""}`);
    }
  }, [items, openIndex, rowActions, zoomToRow]);
  const openMenu = useCallback((itemIndex: number, top: number) => { haptic.tap(); menuItem.current = itemIndex; setHovered(-1); setMenu({ item: itemIndex, top }); }, []);
  const hover = useCallback((i: number) => { if (i >= 0) haptic.select(); setHovered(i); }, []);

  /** [top, height, isRow] per item: a small array the UI-thread tap handler can copy cheaply. */
  const hit = useMemo(() => items.map((it, i) => [offsets[i] ?? 0, it.h, it.kind === "row" ? 1 : 0] as const), [items, offsets]);
  const rowAtY = (y: number): number => {
    "worklet";
    for (let i = 0; i < hit.length; i += 1) {
      const h = hit[i];
      if (h && y >= h[0] && y < h[0] + h[1]) return h[2] === 1 ? i : -1;
    }
    return -1;
  };

  /* ---- gestures ---- */
  const start = useSharedValue({ tx: 0, z: 1, fx: 0 });
  const lastTick = useSharedValue(-1);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .averageTouches(true)
    .onStart(() => { cancelAnimation(tx); cancelAnimation(zoom); start.value = { tx: tx.value, z: zoom.value, fx: 0 }; })
    .onUpdate((e) => {
      const [lo, hi] = panBounds(viewW.value * zoom.value, viewW.value);
      tx.value = softClamp(start.value.tx + e.translationX, lo, hi, viewW.value);
    })
    .onEnd((e) => {
      const [lo, hi] = panBounds(viewW.value * zoom.value, viewW.value);
      if (tx.value < lo || tx.value > hi) { tx.value = withTiming(tx.value < lo ? lo : hi, { ...settleTiming((tx.value < lo ? lo : hi) - tx.value, e.velocityX), reduceMotion: ReduceMotion.System }); return; }
      if (reduced) return;
      const target = Math.min(hi, Math.max(lo, tx.value + e.velocityX * 0.08));
      tx.value = withTiming(target, { ...settleTiming(target - tx.value, e.velocityX), reduceMotion: ReduceMotion.System });
    });

  const pinch = Gesture.Pinch()
    .onStart((e) => { cancelAnimation(tx); cancelAnimation(zoom); start.value = { tx: tx.value, z: zoom.value, fx: e.focalX }; })
    .onUpdate((e) => {
      const z = softZoom(start.value.z * e.scale);
      const moved = e.focalX - start.value.fx;
      const next = zoomAround(start.value.fx, start.value.tx, start.value.z, z) + moved;
      const [lo, hi] = panBounds(viewW.value * z, viewW.value);
      zoom.value = z;
      tx.value = softClamp(next, lo, hi, viewW.value);
    })
    .onEnd((e) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value));
      const target = zoomAround(e.focalX, tx.value, zoom.value, z);
      const [lo, hi] = panBounds(viewW.value * z, viewW.value);
      zoom.value = withTiming(z, settle);
      tx.value = withTiming(Math.min(hi, Math.max(lo, target)), settle);
    });

  const scrubG = Gesture.Pan()
    .activateAfterLongPress(320)
    .onStart((e) => {
      const r = rowAtY(e.y);
      if (r >= 0) {
        const h = hit[r];
        const top = h ? h[0] + h[1] : e.y;
        menuMode.value = 1; menuTop.value = top + 34; hoverIdx.value = -1;
        runOnJS(openMenu)(r, top);
        return;
      }
      menuMode.value = 0;
      scrubX.value = e.x;
      scrubOn.value = withTiming(1, { ...fade, reduceMotion: ReduceMotion.System });
      const t = timeAtX(e.x, tx.value, viewW.value, zoom.value, span);
      lastTick.value = scrubTick(t, SCRUB_STEP_S);
      runOnJS(scrubTo)(t, false, true);
    })
    .onUpdate((e) => {
      if (menuMode.value === 1) {
        const i = Math.floor((e.y - menuTop.value) / MENU_ROW_H);
        const next = i >= 0 && i < rowActions.length ? i : -1;
        if (next !== hoverIdx.value) { hoverIdx.value = next; runOnJS(hover)(next); }
        return;
      }
      const x = Math.min(viewW.value, Math.max(0, e.x));
      scrubX.value = x;
      const t = timeAtX(x, tx.value, viewW.value, zoom.value, span);
      const tick = scrubTick(t, SCRUB_STEP_S);
      if (tick !== lastTick.value) { lastTick.value = tick; runOnJS(scrubTo)(t, tick % 4 === 0, false); }
    })
    .onEnd(() => {
      if (menuMode.value === 1 && hoverIdx.value >= 0) runOnJS(runAction)(-1, hoverIdx.value);
    })
    .onFinalize(() => {
      if (menuMode.value === 1) { menuMode.value = 0; return; }
      scrubOn.value = withTiming(0, { ...fade, reduceMotion: ReduceMotion.System }); lastTick.value = -1; runOnJS(scrubEnd)();
    });

  const tap = Gesture.Tap()
    .maxDuration(300)
    .onBegin((e) => { pressedRow.value = rowAtY(e.y); })
    .onEnd((e) => { const i = rowAtY(e.y); if (i >= 0) runOnJS(openIndex)(i); })
    .onFinalize(() => { pressedRow.value = -1; });

  if (scrollRef) {
    scrubG.blocksExternalGesture(scrollRef);
    pinch.blocksExternalGesture(scrollRef);
  }
  const gesture = Gesture.Race(scrubG, Gesture.Simultaneous(pan, pinch), tap);

  const zoomTo = useCallback((z: number) => {
    haptic.select();
    const w = viewW.value;
    if (!w) return;
    zoom.value = withTiming(z, { ...snappy, reduceMotion: ReduceMotion.System });
    tx.value = withTiming(txForTime(snapshot.now, span, w, z, OPEN_FRAC), { ...snappy, reduceMotion: ReduceMotion.System });
  }, [snapshot.now, span, tx, viewW, zoom]);

  const content = useAnimatedStyle(() => ({ width: viewW.value * zoom.value, transform: [{ translateX: tx.value }] }));
  const playhead = useAnimatedStyle(() => ({ opacity: scrubOn.value, transform: [{ translateX: scrubX.value }] }));

  const pct = (t: number) => `${(t / span) * 100}%` as const;
  const hours = useMemo(() => { const out: number[] = []; for (let t = 0; t <= span; t += 3600) out.push(t); return out; }, [span]);

  return (
    <View ref={wrapRef} style={styles.wrap} testID={testID}>
      {/* labels column */}
      <View style={styles.labels}>
        {items.map((it, i) => {
          if (it.kind === "axis") return <ZoomControls key={i} h={it.h} onZoom={zoomTo} span={span} />;
          if (it.kind === "lane") return <View key={i} style={[styles.laneLabel, { height: it.h }]}><Text style={styles.laneText} numberOfLines={1}>{it.lane === "cuts" ? "cut moments" : `your messages · ${snapshot.owner.length}`}</Text></View>;
          if (it.kind === "group") return <GroupLabel key={i} group={it.group} n={it.n} h={it.h} />;
          return (
            <RowLabel key={i} row={it.row} h={it.h} selected={selectedKey === it.row.key} variant={variant}
              refCb={(r) => { labelRefs.current.set(it.row.key, r); }} onPress={onOpenRow ? () => openIndex(i) : undefined} />
          );
        })}
      </View>
      {/* plot column */}
      <GestureDetector gesture={gesture}>
        <View style={[styles.plot, plotW === 0 && { opacity: 0 }]} onLayout={onPlotLayout} testID={`${testID}-plot`} accessibilityLabel="Timeline. Pinch to zoom, drag to pan, long-press to scrub.">
          {/* grid + now line */}
          <Animated.View pointerEvents="none" style={[styles.layer, content]}>
            {hours.map((t) => <View key={t} style={[styles.hourLine, { left: pct(t) }]} />)}
            <View style={[styles.nowLine, { left: pct(snapshot.now) }]} />
          </Animated.View>
          {items.map((it, i) => {
            if (it.kind === "axis") return <Axis key={i} h={it.h} hours={hours} span={span} t0={snapshot.t0} now={snapshot.now} content={content} viewW={viewW} zoom={zoom} />;
            if (it.kind === "lane") return (
              <View key={i} style={[styles.rowClip, { height: it.h }]}>
                <Animated.View style={[styles.layer, content]}>
                  {(it.lane === "cuts" ? cutTimes : snapshot.owner).map((t, j) => (
                    <View key={j} style={[it.lane === "cuts" ? styles.cutMark : styles.youMark, { left: pct(t) }]} />
                  ))}
                </Animated.View>
              </View>
            );
            if (it.kind === "group") return <View key={i} style={[styles.groupRule, { height: it.h }]} />;
            return (
              <PlotRow key={i} index={i} item={it} span={span} now={snapshot.now} variant={variant} maxDensity={maxDensity}
                content={content} pressed={pressedRow} selected={selectedKey === it.row.key} dim={it.row.group === "earlier"} />
            );
          })}
          <Animated.View pointerEvents="none" style={[styles.playhead, playhead]} testID="scrub-playhead">
            <View style={styles.playheadLine} />
            <View style={styles.playheadKnob} />
          </Animated.View>
          {scrub && !onScrub ? (
            <View pointerEvents="none" style={styles.readout} testID="scrub-readout">
              <Text style={styles.readoutText}>{scrub.label}</Text>
              <Text style={styles.readoutSub}>{scrub.live} live</Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>
      {menu ? <>
        <Pressable accessibilityLabel="Close row menu" onPress={() => { setMenu(null); setHovered(-1); }} style={StyleSheet.absoluteFill} />
        <View accessibilityRole="menu" style={[styles.rowMenu, { top: menu.top + 4 }]}>
          {(() => { const it = items[menu.item]; return it && it.kind === "row" ? <Text style={styles.rowMenuTitle} numberOfLines={1}>{it.row.goal}</Text> : null; })()}
          {rowActions.map((a, k) => (
            <Pressable key={a.id} accessibilityRole="menuitem" onPress={() => runAction(menu.item, k)}
              style={[styles.rowMenuItem, hovered === k && styles.rowMenuItemOn]}>
              <Text style={[styles.rowMenuText, hovered === k && styles.rowMenuTextOn]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </> : null}
    </View>
  );
});

function ZoomControls({ h, onZoom, span }: { h: number; onZoom(z: number): void; span: number }) {
  const opts: { label: string; z: number }[] = [
    { label: "fit", z: 1 },
    { label: "3h", z: Math.min(ZOOM_MAX, span / (3 * 3600)) },
    { label: "1h", z: Math.min(ZOOM_MAX, span / 3600) },
  ];
  return (
    <View style={[styles.zoomRow, { height: h }]}>
      {opts.map((o) => (
        <PressScale key={o.label} scaleTo={0.9} onPress={() => onZoom(o.z)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel={`Zoom ${o.label}`} hitSlop={6}>
          <Text style={styles.zoomText}>{o.label}</Text>
        </PressScale>
      ))}
    </View>
  );
}

function GroupLabel({ group, n, h }: { group: RowGroup; n: number; h: number }) {
  return (
    <View style={[styles.groupLabel, { height: h }]}>
      {group === "live" ? <LivePulse size={6} style={{ marginRight: 6 }} /> : null}
      <Text style={[styles.groupText, group === "live" && { color: tc.live }, group === "earlier" && { color: tc.text3 }]} numberOfLines={1}>{GROUP_LABEL[group]} · {n}</Text>
    </View>
  );
}

const RowLabel = memo(function RowLabel({ row, h, selected, onPress, refCb, variant }: { row: TraceRow; h: number; selected: boolean; onPress?(): void; refCb(r: View | null): void; variant: RowVariant }) {
  const sum = summarizeRow(row);
  const dim = row.group === "earlier";
  return (
    <View ref={refCb} collapsable={false} style={{ height: h }}>
      <InteractiveTile title={row.key} summary={`${row.key}. ${rowMeta(sum)}`} onOpen={onPress} style={[styles.rowLabel, selected && styles.rowSel]} testID={`row-${row.key}`}>
        <View style={[styles.rowLabelInner, dim && { opacity: 0.55 }]}>
          <Text style={styles.project} numberOfLines={1}>{row.project}{sum.workers > 1 ? <Text style={styles.count}>  ×{sum.workers}</Text> : null}</Text>
          {variant === "compact" ? null : <Text style={styles.goal} numberOfLines={1}>{row.goal}</Text>}
          {sum.cut || sum.asks ? (
            <Text style={styles.meta} numberOfLines={1}>
              {sum.cut ? <Text style={{ color: tc.cut }}>{sum.cut} cut</Text> : null}{sum.cut && sum.asks ? " · " : null}{sum.asks ? <Text style={{ color: tc.ask }}>{sum.asks} ask{sum.asks === 1 ? "" : "s"}</Text> : null}
            </Text>
          ) : null}
        </View>
      </InteractiveTile>
    </View>
  );
});

function Axis({ h, hours, span, t0, now, content, viewW, zoom }: { h: number; hours: number[]; span: number; t0: string; now: number; content: ReturnType<typeof useAnimatedStyle>; viewW: SharedValue<number>; zoom: SharedValue<number> }) {
  const { fontScale } = useDensity();
  const step = useSharedValue(1);
  useAnimatedReaction(() => hourStep(viewW.value / fontScale, zoom.value, span), (s) => { step.value = s; });
  return (
    <View style={[styles.rowClip, { height: h, borderBottomWidth: 1, borderBottomColor: tc.rule }]}>
      <Animated.View style={[styles.layer, content]}>
        {hours.filter((t) => t < now - 900).map((t, i) => <HourLabel key={t} i={i} left={`${(t / span) * 100}%`} text={clock(t0, t)} step={step} t={t} now={now} span={span} viewW={viewW} zoom={zoom} fontScale={fontScale} />)}
        <View style={[styles.nowTag, { right: `${(1 - now / span) * 100}%` }]}><Text style={styles.nowText}>now {clock(t0, now)}</Text></View>
      </Animated.View>
    </View>
  );
}

function HourLabel({ i, left, text, step, t, now, span, viewW, zoom, fontScale }: { i: number; left: `${number}%`; text: string; step: SharedValue<number>; t: number; now: number; span: number; viewW: SharedValue<number>; zoom: SharedValue<number>; fontScale: number }) {
  const st = useAnimatedStyle(() => ({ opacity: withTiming(i % step.value === 0 && (now - t) / span * viewW.value * zoom.value > 64 * fontScale ? 1 : 0, { ...fade, reduceMotion: ReduceMotion.System }) }));
  return <DensityAnimatedText style={[styles.hourText, { left }, st]}>{text}</DensityAnimatedText>;
}

const PlotRow = memo(function PlotRow({ index, item, span, now, variant, maxDensity, content, pressed, selected, dim }: {
  index: number;
  item: Extract<Item, { kind: "row" }>;
  span: number; now: number; variant: RowVariant; maxDensity: number;
  content: ReturnType<typeof useAnimatedStyle>;
  pressed: SharedValue<number>; selected: boolean; dim: boolean;
}) {
  const press = useAnimatedStyle(() => ({ backgroundColor: pressed.value === index ? "rgba(236,232,223,.05)" : "transparent" }));
  const last = item.row.workers.reduce<TraceWorker | null>((a, w) => (!a || w.e > a.e ? w : a), null);
  return (
    <Animated.View style={[styles.rowClip, { height: item.h }, selected && styles.plotSel, press]}>
      <Animated.View style={[styles.layer, content, dim && { opacity: 0.45 }]}>
        {variant === "density"
          ? <DensityStrip row={item.row} span={span} h={item.h} max={maxDensity} />
          : item.row.workers.map((w, j) => (
            <WorkerBar key={w.id} w={w} lane={item.lanes[j] ?? 0} span={span} variant={variant} max={maxDensity} step={(item.h - 28) / item.nLanes} />
          ))}
        {last ? <EndNote w={last} span={span} now={now} below={item.h - 17} y={variant === "density" ? 18 : 8 + (item.lanes[item.row.workers.indexOf(last)] ?? 0) * ((item.h - 28) / item.nLanes)} /> : null}
      </Animated.View>
    </Animated.View>
  );
});

function WorkerBar({ w, lane, span, variant, max, step }: { w: TraceWorker; lane: number; span: number; variant: RowVariant; max: number; step: number }) {
  const live = w.status === "running";
  const left = `${(w.s / span) * 100}%` as const;
  const width = `${(Math.max(60, w.e - w.s) / span) * 100}%` as const;
  if (variant === "compact") {
    return <View style={[styles.line, { left, width, top: 10 + lane * step, backgroundColor: live ? tc.live : w.status === "interrupted" ? tc.cut : tc.tick }]} />;
  }
  const top = 10 + lane * step;
  const n = w.density.length;
  const len = Math.max(60, w.e - w.s);
  return (
    <View style={[styles.bar, { left, width, top, height: Math.max(9, step - 3) }, live ? styles.barLive : null]}>
      {w.density.map((d, i) => d === 0 ? null : (
        <View key={i} style={[styles.tick, { left: `${(i / n) * 100}%`, width: `${Math.max(0.6, 70 / n)}%`, height: `${Math.max(14, (d / max) * 100)}%` }]} />
      ))}
      {w.stalls.map(([a, b], i) => <View key={`s${i}`} style={[styles.stall, { left: `${((a - w.s) / len) * 100}%`, width: `${((b - a) / len) * 100}%` }]} />)}
      {w.fails.map((f, i) => <View key={`f${i}`} style={[styles.fail, { left: `${((f - w.s) / len) * 100}%` }]} />)}
      {w.status === "interrupted" ? <View style={styles.cutCap} /> : null}
      {live ? <View style={styles.liveCap} /> : null}
    </View>
  );
}

function DensityStrip({ row, span, h, max }: { row: TraceRow; span: number; h: number; max: number }) {
  const cols: ReactNode[] = [];
  for (const w of row.workers) {
    const len = Math.max(60, w.e - w.s);
    w.density.forEach((d, i) => {
      if (!d) return;
      const t = w.s + (i / w.density.length) * len;
      const hh = Math.max(3, (d / max) * (h - 22));
      cols.push(<View key={`${w.id}-${i}`} style={[styles.dcol, { left: `${(t / span) * 100}%`, height: hh, top: h - 8 - hh, backgroundColor: w.status === "running" ? tc.live : w.status === "interrupted" ? "rgba(227,127,101,.7)" : tc.tick }]} />);
    });
  }
  return <>{cols}</>;
}

/**
 * Inline note at a worker's end: live / asks / cut (round-3 rule). Notes that end within 40 min
 * of now sit under the bar, right-aligned to its end, so they never run off the right edge.
 */
function EndNote({ w, span, now, y, below }: { w: TraceWorker; span: number; now: number; y: number; below: number }) {
  const left = `${(w.e / span) * 100}%` as const;
  if (w.status === "running") {
    return (
      <View style={[styles.note, styles.noteLeft, { left, top: y - 3 }]}>
        <LivePulse size={6} />
        <Text style={[styles.noteText, { color: tc.live }]} accessibilityLabel={`live for ${dur(now - w.s)}`}>{dur(now - w.s)}</Text>
      </View>
    );
  }
  const text = w.asks.length ? `asks ${askWord(w.asks[0] ?? "")}` : w.status === "interrupted" && !w.resumed ? "cut" : null;
  if (!text) return null;
  const color = w.asks.length ? tc.ask : tc.cut;
  const nearNow = now - w.e < 2400;
  const pos = nearNow ? { right: `${(1 - w.e / span) * 100}%` as const, top: below, marginRight: 0, justifyContent: "flex-end" as const } : [styles.noteLeft, { left, top: y - 3 }];
  return (
    <View style={[styles.note, pos]}>
      {w.asks.length && !nearNow ? <View style={styles.diamond} /> : null}
      <Text style={[styles.noteText, { color }]} numberOfLines={1}>{text}</Text>
      {w.asks.length && nearNow ? <View style={styles.diamond} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowMenu: { position: "absolute", left: 12, width: 240, borderRadius: 14, paddingVertical: 4, backgroundColor: "rgba(22,22,20,0.97)", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hair, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  rowMenuTitle: { height: 26, fontFamily: fonts.mono, fontSize: 10, lineHeight: 26, color: colors.textTertiary, paddingHorizontal: 14 },
  rowMenuItem: { height: 44, justifyContent: "center", paddingHorizontal: 14, marginHorizontal: 4, borderRadius: 10 },
  rowMenuItemOn: { backgroundColor: "rgba(236,232,223,0.10)" },
  rowMenuText: { fontSize: 15, color: colors.textMuted },
  rowMenuTextOn: { color: colors.text },
  wrap: { flexDirection: "row", borderTopWidth: 1, borderTopColor: tc.rule },
  labels: { width: `${LABEL_FRAC * 100}%`, borderRightWidth: 1, borderRightColor: tc.rule },
  plot: { flex: 1, overflow: "hidden" },
  layer: { position: "absolute", top: 0, bottom: 0, left: 0 },
  rowClip: { overflow: "visible", position: "relative" },
  hourLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: tc.grid },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(129,185,218,.55)" },
  nowTag: { position: "absolute", top: 4, marginRight: 4 },
  nowText: { fontFamily: fonts.mono, fontSize: 10, color: tc.live },
  hourText: { position: "absolute", bottom: 6, marginLeft: 4, fontFamily: fonts.mono, fontSize: 10, color: tc.text3 },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: tc.rule },
  zoomBtn: { minWidth: 28, height: 24, borderRadius: radius.sm, backgroundColor: "rgba(236,232,223,.05)" },
  zoomText: { fontFamily: fonts.mono, fontSize: 10, color: tc.text2 },
  laneLabel: { justifyContent: "center", paddingHorizontal: 8 },
  laneText: { fontFamily: fonts.mono, fontSize: 10, color: tc.text3 },
  cutMark: { position: "absolute", top: 7, width: 3, height: 8, marginLeft: -1, backgroundColor: tc.cut },
  youMark: { position: "absolute", top: 8, width: 1.5, height: 7, backgroundColor: tc.text2 },
  groupLabel: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: tc.rule },
  groupText: { ...type.label, color: tc.text, fontSize: 12 },
  groupRule: { borderTopWidth: 1, borderTopColor: tc.rule },
  rowLabel: { flex: 1, alignItems: "stretch", justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tc.grid },
  rowLabelInner: { flex: 1, justifyContent: "center", paddingHorizontal: 8, alignSelf: "stretch" },
  rowSel: { backgroundColor: "rgba(236,232,223,.06)", borderLeftWidth: 2, borderLeftColor: tc.text },
  plotSel: { backgroundColor: "rgba(236,232,223,.04)" },
  project: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16, color: tc.text },
  goal: { fontFamily: fonts.body, fontSize: 12, lineHeight: 15, color: tc.text2 },
  count: { fontFamily: fonts.mono, fontSize: 10, color: tc.text3, fontWeight: "400" },
  meta: { fontFamily: fonts.mono, fontSize: 10, lineHeight: 14, color: tc.text3 },
  bar: { position: "absolute", height: 9, borderRadius: 2, backgroundColor: tc.bar, borderWidth: 1, borderColor: tc.barEdge, overflow: "visible" },
  barLive: { backgroundColor: tc.barLive, borderColor: tc.barLiveEdge },
  tick: { position: "absolute", bottom: 0, backgroundColor: tc.tick },
  stall: { position: "absolute", top: 0, bottom: 0, backgroundColor: "rgba(227,127,101,.28)" },
  fail: { position: "absolute", top: -5, width: 3, height: 3, backgroundColor: tc.cut },
  cutCap: { position: "absolute", right: -1, top: -3, bottom: -3, width: 2, backgroundColor: tc.cut },
  liveCap: { position: "absolute", right: -1, top: -3, bottom: -3, width: 2, backgroundColor: tc.live },
  line: { position: "absolute", height: 3, borderRadius: 1.5 },
  dcol: { position: "absolute", width: 2 },
  note: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 7 },
  /** Absolute notes past the content edge would shrink-wrap and break lines on web; give them room. */
  noteLeft: { width: 160 },
  noteText: { fontFamily: fonts.mono, fontSize: 10 },
  diamond: { width: 6, height: 6, backgroundColor: tc.ask, transform: [{ rotate: "45deg" }] },
  playhead: { position: "absolute", top: 0, bottom: 0, left: 0, width: 1 },
  playheadLine: { position: "absolute", top: 0, bottom: 0, left: 0, width: 1.5, backgroundColor: tc.text },
  playheadKnob: { position: "absolute", top: 0, left: -4, width: 9, height: 9, borderRadius: 4.5, backgroundColor: tc.text },
  readout: { position: "absolute", top: 2, left: 6, flexDirection: "row", gap: 6, alignItems: "baseline", backgroundColor: "rgba(12,12,10,.92)", borderWidth: 1, borderColor: tc.rule, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  readoutText: { fontFamily: fonts.mono, fontSize: 13, color: tc.text, fontVariant: ["tabular-nums"] },
  readoutSub: { fontFamily: fonts.mono, fontSize: 11, color: tc.live },
});

