/**
 * Small Expo-Go-safe AODL identity core. Geometry, hue, effort, runes and
 * runtime cadence come from the pinned visual.json catalog via resolveHarnessVisual.
 * This is not a topology renderer; use TopologyBadge with declared IR ids for that.
 */
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import type { HarnessVisualLook } from "../catalog/visual";

interface Props {
  look: HarnessVisualLook;
  name: string;
  size: number;
}

function ModelCore({ core, color, size }: { core: string; color: string; size: number }) {
  const unit = size * 0.12;
  const line = { backgroundColor: color, borderRadius: unit / 3 };
  const center = { alignItems: "center" as const, justifyContent: "center" as const };
  switch (core) {
    case "lattice":
      return (
        <View style={[center, { width: size, height: size }]}>
          <View style={{ width: size * 0.37, height: size * 0.37, borderWidth: 2, borderColor: color, transform: [{ rotate: "45deg" }] }} />
          <View style={[line, { position: "absolute", width: size * 0.42, height: 2 }]} />
          <View style={[line, { position: "absolute", width: 2, height: size * 0.42 }]} />
        </View>
      );
    case "facet":
      return <View style={{ width: size * 0.34, height: size * 0.34, borderWidth: 2, borderColor: color, backgroundColor: `${color}25`, transform: [{ rotate: "45deg" }] }} />;
    case "flare":
      return (
        <View style={[center, { width: size, height: size }]}>
          {[0, 45, 90, 135].map(angle => (
            <View key={angle} style={[line, { position: "absolute", width: size * 0.45, height: 2, transform: [{ rotate: `${angle}deg` }] }]} />
          ))}
          <View style={{ width: unit, height: unit, borderRadius: unit / 2, backgroundColor: color }} />
        </View>
      );
    case "crescent":
      return (
        <View style={{ width: size * 0.34, height: size * 0.34, borderRadius: size, backgroundColor: color, overflow: "hidden" }}>
          <View style={{ position: "absolute", width: size * 0.30, height: size * 0.30, borderRadius: size, backgroundColor: "#000000", left: size * 0.12, bottom: size * 0.10 }} />
        </View>
      );
    case "prism":
      return <View style={{ width: 0, height: 0, borderLeftWidth: size * 0.2, borderRightWidth: size * 0.2, borderBottomWidth: size * 0.36, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color }} />;
    case "bracket":
      return (
        <View style={{ width: size * 0.40, height: size * 0.38, flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ width: size * 0.12, borderLeftWidth: 2, borderTopWidth: 2, borderBottomWidth: 2, borderColor: color }} />
          <View style={{ width: size * 0.12, borderRightWidth: 2, borderTopWidth: 2, borderBottomWidth: 2, borderColor: color }} />
        </View>
      );
    case "linked":
      return (
        <View style={{ width: size * 0.46, height: size * 0.28, flexDirection: "row", alignItems: "center" }}>
          {[0, 1].map(i => <View key={i} style={{ marginLeft: i ? -size * 0.06 : 0, width: size * 0.26, height: size * 0.26, borderRadius: size, borderWidth: 2, borderColor: color }} />)}
        </View>
      );
    case "plain":
      return <View style={{ width: unit, height: unit, borderRadius: unit / 2, backgroundColor: color }} />;
    default:
      // Unknown catalog geometry is intentionally absent, never approximated.
      return null;
  }
}

function ModeRune({ marker, color, size }: { marker: string; color: string; size: number }) {
  const dot = { backgroundColor: color, width: size * 0.16, height: size * 0.16, borderRadius: size };
  if (marker === "unknown") return null;
  if (marker === "crescent") return (
    <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size, backgroundColor: color, overflow: "hidden" }}>
      <View style={{ width: size * 0.38, height: size * 0.38, borderRadius: size, backgroundColor: "#000000", position: "absolute", left: size * 0.17, bottom: size * 0.13 }} />
    </View>
  );
  if (marker === "cycle") return <View style={{ width: size * 0.45, height: size * 0.45, borderRadius: size, borderWidth: 1.5, borderColor: color }} />;
  if (marker === "link") return <View style={{ flexDirection: "row", alignItems: "center" }}><View style={dot} /><View style={{ width: size * 0.16, height: 1, backgroundColor: color }} /><View style={dot} /></View>;
  if (marker === "fork") return <View style={{ alignItems: "center" }}><View style={{ flexDirection: "row", gap: size * 0.12 }}><View style={dot} /><View style={dot} /></View><View style={{ width: 1, height: size * 0.14, backgroundColor: color }} /><View style={dot} /></View>;
  if (marker === "stack") return <View style={{ gap: size * 0.09 }}>{[0, 1, 2].map(i => <View key={i} style={{ width: size * 0.40, height: 1, backgroundColor: color }} />)}</View>;
  return null;
}

export function HarnessVisualCore({ look, name, size }: Props) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const phase = useRef(new Animated.Value(0)).current;
  const { cadence } = look.state;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReducedMotion(enabled);
    }).catch(() => {
      if (mounted) setReducedMotion(true);
    });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    phase.stopAnimation();
    phase.setValue(0);
    if (reducedMotion || cadence.periodMs <= 0) return;
    const loop = Animated.loop(Animated.timing(phase, {
      toValue: 1,
      duration: cadence.periodMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [cadence.periodMs, phase, reducedMotion]);

  const rotation = phase.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const pulsing = phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [cadence.opacityMin, cadence.opacityMax, cadence.opacityMin] });
  const isMoving = !reducedMotion && cadence.periodMs > 0;
  const statusHollow = look.state.marker === "hollow";
  const ringOpacity = 0.10 + look.effort.energy * 0.18;
  const description = [
    name,
    `${look.provider.label} provider`,
    `${look.model.label} model`,
    `${look.state.label} state`,
    look.operatingMode.id === "unknown" ? null : `${look.operatingMode.label} mode`,
    look.valueScore === null ? "value unmeasured" : `value score ${look.valueScore}`,
  ].filter(part => part !== null).join(", ");

  return (
    <View accessibilityRole="image" accessibilityLabel={description} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: StyleSheet.hairlineWidth, borderColor: look.provider.hue, borderStyle: look.valueScore === null ? "dashed" : "solid", opacity: 0.75 }} />
      {Array.from({ length: look.effort.orbits }, (_, i) => {
        const diameter = size * (0.47 + i * 0.11);
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              borderWidth: 1,
              borderColor: look.provider.hue,
              opacity: isMoving ? pulsing : ringOpacity,
              transform: [{ rotate: isMoving && cadence.rotate ? rotation : "0deg" }],
            }}
          />
        );
      })}
      <ModelCore core={look.model.core} color={look.model.accent} size={size * 0.72} />
      {look.operatingMode.id !== "unknown" ? (
        <View style={{ position: "absolute", left: size * 0.04, bottom: size * 0.04 }}>
          <ModeRune marker={look.operatingMode.marker} color={look.operatingMode.accent} size={size * 0.36} />
        </View>
      ) : null}
      <View style={{
        position: "absolute", right: 0, bottom: 0,
        width: Math.max(6, size * 0.16), height: Math.max(6, size * 0.16),
        borderRadius: statusHollow ? size : look.state.marker === "contain" ? 2 : size,
        borderWidth: statusHollow ? 1.5 : 0,
        borderColor: look.state.accent,
        backgroundColor: statusHollow ? "transparent" : look.state.accent,
        opacity: cadence.opacityMax,
      }} />
    </View>
  );
}
