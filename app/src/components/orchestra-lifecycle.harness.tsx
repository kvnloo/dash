/**
 * Run by orchestra-lifecycle.test.ts in its own Bun process (module mocks stay out of other suites).
 * Mounts the real OrchestraGraph, PressScale, InteractiveTile and TileGestures with react-dom/client on a
 * mini DOM. Reanimated / Gesture Handler are replaced by a ledger that counts running animations,
 * attached mappers, attached gesture handlers and AppState listeners.
 */
import { mock } from "bun:test";
import React, { act, createContext, useEffect, useRef, type ReactNode } from "react";
import { installMiniDom } from "../test-support/mini-dom";

const container = installMiniDom();

type Anim = { kind: "timing" | "repeat"; to?: number };
type SV = { value: unknown; _anim: Anim | null };
const ledger = {
  running: new Set<SV>(),       // shared values with an unfinished animation
  mappers: 0,                   // mounted useAnimatedStyle mappers
  appState: 0,                  // AppState listeners
  detectors: new Set<{ gesture: Gesture }>(),
  reattaches: 0,                // a still-mounted GestureDetector got a new Gesture (native re-attach)
};

function sharedValue(initial: unknown): SV {
  let raw = initial;
  const sv: SV = {
    _anim: null,
    get value() { return raw; },
    set value(next: unknown) {
      if (next && typeof next === "object" && "__anim" in next) {
        const anim = (next as { __anim: Anim }).__anim;
        sv._anim = anim; ledger.running.add(sv);
        if (anim.to !== undefined) raw = anim.to;
      } else { raw = next; sv._anim = null; ledger.running.delete(sv); }
    },
  };
  return sv;
}
/** Finite timings finish on the next frame; repeats never do. */
function flushFrames() { for (const sv of [...ledger.running]) if (sv._anim?.kind === "timing") { sv._anim = null; ledger.running.delete(sv); } }

class Gesture {
  handlers: Record<string, (...args: unknown[]) => void> = {};
  constructor(public type: string, public children: Gesture[] = []) {}
}
const chain = (g: Gesture) => new Proxy(g, {
  get(target, key: string) {
    if (key in target) return Reflect.get(target, key);
    return (fn: unknown) => { if (typeof fn === "function" && key.startsWith("on")) target.handlers[key] = fn as (...args: unknown[]) => void; return chain(target); };
  },
});

mock.module("react-native-reanimated", () => {
  const AnimatedView = ({ children, style, testID }: { children?: ReactNode; style?: unknown; testID?: string }) => React.createElement("div", { "data-testid": testID, "data-style": JSON.stringify(flat(style)) }, children);
  const flat = (style: unknown): unknown => Array.isArray(style) ? Object.assign({}, ...style.map(flat).filter(Boolean)) : style;
  return {
    default: { View: AnimatedView, Text: AnimatedView, createAnimatedComponent: (c: unknown) => c },
    useSharedValue: (initial: unknown) => { const ref = useRef<SV | null>(null); ref.current ??= sharedValue(initial); return ref.current; },
    useAnimatedStyle: (fn: () => unknown) => { useEffect(() => { ledger.mappers++; return () => { ledger.mappers--; }; }, []); return fn(); },
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedReaction: () => {},
    useReducedMotion: () => false,
    withTiming: (to: number) => ({ __anim: { kind: "timing", to } }),
    withRepeat: () => ({ __anim: { kind: "repeat" } }),
    withDelay: (_ms: number, anim: unknown) => anim,
    cancelAnimation: (sv: SV) => { sv._anim = null; ledger.running.delete(sv); },
    runOnJS: (fn: unknown) => fn,
    ReduceMotion: { System: "system" },
    Easing: { linear: (t: number) => t, quad: (t: number) => t, inOut: (f: unknown) => f },
  };
});
mock.module("react-native-gesture-handler", () => ({
  Gesture: Object.fromEntries(["Manual", "Tap", "Pan"].map(type => [type, () => chain(new Gesture(type))]).concat(
    ["Race", "Exclusive", "Simultaneous"].map(type => [type, (...children: Gesture[]) => chain(new Gesture(type, children))]))),
  GestureDetector: ({ gesture, children }: { gesture: Gesture; children: ReactNode }) => {
    const seen = useRef(false);
    useEffect(() => { if (seen.current) ledger.reattaches++; seen.current = true; const entry = { gesture }; ledger.detectors.add(entry); return () => { ledger.detectors.delete(entry); }; }, [gesture]);
    return children;
  },
}));
const View = ({ children, testID, accessibilityLabel }: { children?: ReactNode; testID?: string; accessibilityLabel?: string }) => React.createElement("div", { "data-testid": testID, "aria-label": accessibilityLabel }, children);
const Pressable = ({ children, accessibilityLabel, onPress }: { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void }) => {
  const el = React.createElement("button", { "aria-label": accessibilityLabel }, children);
  presses.set(accessibilityLabel ?? "", onPress);
  return el;
};
const presses = new Map<string, (() => void) | undefined>();
mock.module("react-native", () => ({
  Platform: { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default },
  PixelRatio: { getFontScale: () => 1, roundToNearestPixel: (n: number) => n, get: () => 3 },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s, hairlineWidth: 1, absoluteFill: {} },
  View, ScrollView: View, Pressable,
  Text: ({ children }: { children?: ReactNode }) => React.createElement("span", null, children),
  FlatList: ({ data, renderItem, keyExtractor, ListHeaderComponent }: { data: unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode; keyExtractor: (item: unknown) => string; ListHeaderComponent?: ReactNode }) =>
    React.createElement("div", { "data-testid": "flatlist" }, ListHeaderComponent, data.map((item, index) => React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index })))),
  Linking: { openURL: async () => {} },
  AppState: { currentState: "active", addEventListener: () => { ledger.appState++; return { remove: () => { ledger.appState--; } }; } },
  AccessibilityInfo: { setAccessibilityFocus: () => {}, announceForAccessibility: () => {} },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  findNodeHandle: () => null,
  useWindowDimensions: () => ({ width: 412, height: 915, fontScale: 1, scale: 3 }),
  I18nManager: { isRTL: false },
}));
mock.module("@react-navigation/native", () => ({ NavigationContext: createContext(null), useIsFocused: () => true }));
mock.module("expo-clipboard", () => ({ setStringAsync: async () => true }));
mock.module("expo-haptics", () => ({ selectionAsync: async () => {}, impactAsync: async () => {}, notificationAsync: async () => {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
mock.module("../haptics", () => ({ haptic: { select: () => {}, success: () => {}, tap: () => {} } }));
mock.module("../lib/useHandedness", () => ({ useHandedness: () => ({ isLeft: false, row: {} }) }));
mock.module("./Tree", () => ({ Tree: ({ nodes }: { nodes: unknown[] }) => React.createElement("div", { "data-testid": "tree", "data-roots": nodes.length }) }));

const { OrchestraGraph } = await import("./IntentionalOrchestra");
const { OrbMotionProvider } = await import("./OrbMotion");
const { TileGestureProvider } = await import("./TileGestures");
const { createRoot } = await import("react-dom/client");

/** Two hosts, 30 sessions, delegation and repo edges: every view renders cards and wires. */
function graph() {
  const nodes: Record<string, unknown>[] = [
    { id: "host:a", hostId: "host:a", label: "host-b", kind: "host", state: "idle", online: true, thinking: { phase: "idle" } },
    { id: "host:b", hostId: "host:b", label: "host-a", kind: "host", state: "idle", online: true, thinking: { phase: "idle" } },
    { id: "repo:dash", hostId: "host:a", label: "dash", kind: "repo", state: "idle", thinking: { phase: "idle" } },
  ];
  const edges: Record<string, unknown>[] = [];
  const states = ["live", "needs-you", "failing", "done", "idle"];
  for (let i = 0; i < 30; i++) {
    const id = `s:${i}`, host = i % 2 ? "host:b" : "host:a";
    nodes.push({ id, hostId: host, label: `session ${i}`, kind: i % 5 === 4 ? "subagent" : "chat", state: states[i % 5], thinking: { phase: "idle" } });
    edges.push({ id: `h:${i}`, from: host, to: id, relation: "hosted", active: false });
    edges.push({ id: `t:${i}`, from: id, to: "repo:dash", relation: "touched", active: i % 5 === 0 });
    if (i % 5 === 4) edges.push({ id: `d:${i}`, from: `s:${i - 4}`, to: id, relation: "delegated", active: true });
  }
  return { nodes, edges };
}

const g = graph();
const App = () => React.createElement(OrbMotionProvider, null, React.createElement(TileGestureProvider, null,
  React.createElement(OrchestraGraph, { graph: g as never, width: 412, onFeedback: () => {} })));
const root = createRoot(container as never);
await act(async () => root.render(React.createElement(App)));
flushFrames();

const snapshot = () => ({ running: ledger.running.size, mappers: ledger.mappers, appState: ledger.appState, detectors: ledger.detectors.size, elements: container.all().length });
const mode = process.argv[2];
if (mode === "switch") {
  const views = ["Fleet", "Lineage", "Work", "Triage"];
  const perView: Record<string, ReturnType<typeof snapshot>[]> = {};
  const reattachesBefore = ledger.reattaches;
  for (let i = 0; i < 50; i++) {
    const view = views[i % 4]!;
    await act(async () => presses.get(view)?.());
    flushFrames();
    (perView[view] ??= []).push(snapshot());
  }
  // Handlers that stayed mounted (tabs, legend, footer) must keep their native gesture across a switch.
  const reattachesPerSwitch = (ledger.reattaches - reattachesBefore) / 50;
  await act(async () => presses.get("Fleet")?.());
  // Flat = every visit to a view leaves exactly the same counts (no growth across 50 switches).
  const distinct = Object.fromEntries(Object.entries(perView).map(([view, snaps]) => [view, [...new Set(snaps.map(snap => JSON.stringify(snap)))].map(json => JSON.parse(json))]));
  console.log(JSON.stringify({ distinct, visits: Object.values(perView).reduce((n, v) => n + v.length, 0), reattachesPerSwitch, hubMore: container.all().filter(e => e.getAttribute("aria-label")?.startsWith("Show ")).length }));
} else if (mode === "unmount") {
  // Press every mounted gesture (touch down / begin) and unmount before the press animation finishes.
  for (const { gesture } of ledger.detectors) {
    const walk = (g: Gesture): void => { g.handlers.onTouchesDown?.(); g.handlers.onBegin?.(); g.children.forEach(walk); };
    walk(gesture);
  }
  const pressed = snapshot();
  await act(async () => root.unmount());
  console.log(JSON.stringify({ pressed, after: snapshot() }));
}
process.exit(0);
