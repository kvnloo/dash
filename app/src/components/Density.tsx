import { createContext, forwardRef, useContext, useMemo, useState, type ComponentRef, type ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions, type TextProps } from "react-native";
import Animated from "react-native-reanimated";
import { LAYOUTS, LAYOUT_LABEL, INFO_LEVELS, resolveDensity, stepLayout, type InfoLevel, type LayoutDensity } from "../lib/density";
import { densityStore, dispatchDensity, useDensityPrefsLoaded } from "../lib/density-store";
import { componentSizing } from "../lib/tile-layout";
import { colors, fonts } from "../theme";
import { PressScale } from "./PressScale";

interface Scope {
  /** Screen id ("orchestra", "trace", "lab", "bots", "chats", "chat"). */
  screen?: string;
  /** Chat id: its override beats the screen's. */
  chat?: string;
  /** Lab previews pin a level without writing prefs. */
  fixedLayout?: LayoutDensity;
  fixedInfo?: InfoLevel;
}

const ScopeContext = createContext<Scope>({});
const TypeScaleContext = createContext<{ typeScale: number; setTypeScale(value: number): void }>({ typeScale: 1, setTypeScale: () => {} });

export function DensityProvider({ children }: { children: ReactNode }) {
  useDensityPrefsLoaded();
  const [typeScale, setTypeScale] = useState(1);
  const value = useMemo(() => ({ typeScale, setTypeScale }), [typeScale]);
  return <TypeScaleContext.Provider value={value}>{children}</TypeScaleContext.Provider>;
}

/** Sets which per-screen (and per-chat) override the subtree reads and writes. */
export function DensityScope({ screen, chat, fixedLayout, fixedInfo, children }: Scope & { children: ReactNode }) {
  const parent = useContext(ScopeContext);
  const value = useMemo<Scope>(() => ({
    screen: screen ?? parent.screen,
    chat: chat ?? parent.chat,
    fixedLayout: fixedLayout ?? parent.fixedLayout,
    fixedInfo: fixedInfo ?? parent.fixedInfo,
  }), [screen, chat, fixedLayout, fixedInfo, parent]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

/** The scope key a write from this subtree lands on: chat override, screen override, or global. */
export function scopeKey(scope: Scope): string | undefined {
  return scope.chat ? `chat:${scope.chat}` : scope.screen;
}

export function useDensityScope(): Scope {
  return useContext(ScopeContext);
}

export function useDensity() {
  const scope = useContext(ScopeContext);
  const { typeScale, setTypeScale } = useContext(TypeScaleContext);
  const prefs = densityStore.use(s => s);
  const resolved = resolveDensity(prefs, scope.screen, scope.chat);
  const layout = scope.fixedLayout ?? resolved.layout;
  const info = scope.fixedInfo ?? resolved.info;
  const { fontScale } = useWindowDimensions();
  const key = scopeKey(scope);
  return {
    /** Layout density; kept under the old name for existing callers. */
    density: layout,
    layout,
    info,
    setDensity: (value: LayoutDensity) => dispatchDensity({ type: "layout", value, scope: key }),
    setLayout: (value: LayoutDensity) => dispatchDensity({ type: "layout", value, scope: key }),
    setInfo: (value: number) => dispatchDensity({ type: "info", value, scope: key }),
    cycleLayout: () => dispatchDensity({ type: "layout", value: layout === "spacious" ? "compact" : stepLayout(layout, 1), scope: key }),
    typeScale,
    setTypeScale,
    fontScale: fontScale * typeScale,
    sizing: componentSizing(layout, fontScale * typeScale),
  };
}

/** Lab preview multiplies the same typography used in native, on top of system font scale. */
export const DensityText = forwardRef<ComponentRef<typeof Text>, TextProps>(function DensityText({ style, ...props }, ref) {
  const { typeScale } = useContext(TypeScaleContext);
  const flat = StyleSheet.flatten(style);
  return <Text ref={ref} {...props} style={[style, typeScale !== 1 && { fontSize: (flat?.fontSize ?? 14) * typeScale, ...(flat?.lineHeight ? { lineHeight: flat.lineHeight * typeScale } : {}) }]} />;
});

export const DensityAnimatedText = Animated.createAnimatedComponent(DensityText);

/** Lab-only large-type preview. Both density axes live in the filter menu. */
export function TypeScaleToggle() {
  const { typeScale, setTypeScale } = useContext(TypeScaleContext);
  return <PressScale onPress={() => setTypeScale(typeScale === 1 ? 1.6 : 1)} accessibilityRole="button" accessibilityLabel="Toggle large type preview" testID="large-type" style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}><Text style={{ color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11 }}>Aa {Math.round(typeScale * 100)}%</Text></PressScale>;
}

/** Static labels for the two axes; used by the menu and the Lab grid. */
export const AXIS_VALUES = {
  info: INFO_LEVELS.map(level => `L${level}`),
  layout: LAYOUTS.map(value => LAYOUT_LABEL[value]),
};

export function LevelBadge({ text }: { text: string }) {
  return <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 6 }}><Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>{text}</Text></View>;
}
