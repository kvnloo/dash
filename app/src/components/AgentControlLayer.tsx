// Agent UI control on screen (docs/specs/ui-control.md): the marks an agent draws (pointer, circle,
// arrow, highlight, strokes) and the visible receipt for every command, with Stop (turn Agent control
// off) and Dismiss. Marks never take touches; labels are plain text.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { measureAgentTarget, type TargetRect } from "../lib/agent-targets";
import type { OverlayItem } from "../lib/ui-control-overlay";
import { ACTIVITY_MS, agentControl, dismissActivity, dismissAgentMarks, expireAgentMarks, setAgentControl } from "../store/agent-control";
import { colors, controlMin, radius, space, type } from "../theme";

type Point = { x: number; y: number };
const MARK = colors.gold;
const STROKE = 3;
/** Re-measure element targets while marks are up, so they follow scrolling and layout. */
const FOLLOW_MS = 200;
/** Total stroke segments drawn per mark (the wire allows 16 x 512 points). */
const MAX_SEGMENTS = 600;

function Segment({ from, to, color = MARK, thickness = STROKE }: { from: Point; to: Point; color?: string; thickness?: number }) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return (
    <View pointerEvents="none" style={{
      position: "absolute", left: (from.x + to.x) / 2 - length / 2, top: (from.y + to.y) / 2 - thickness / 2,
      width: length, height: thickness, borderRadius: thickness / 2, backgroundColor: color,
      transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
    }} />
  );
}

function Label({ text, at, below }: { text: string; at: Point; below: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.label, { left: Math.max(space.sm, at.x - 110), top: below ? at.y + space.sm : at.y - 44 }]}>
      <Text testID="agent-overlay-label" numberOfLines={2} style={styles.labelText}>{text}</Text>
    </View>
  );
}

function Mark({ item, rect, window }: { item: OverlayItem; rect: TargetRect | null | undefined; window: { width: number; height: number } }) {
  if (item.kind === "draw") {
    const color = item.color === "cream" ? colors.ink : MARK;
    const total = item.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    const step = Math.max(1, Math.ceil(total / MAX_SEGMENTS));
    return (
      <View testID="agent-overlay-draw" pointerEvents="none" accessibilityLabel="Agent drawing" style={StyleSheet.absoluteFill}>
        {item.strokes.map((stroke, s) => {
          const points = stroke.points.filter((_, i) => i % step === 0 || i === stroke.points.length - 1).map(([x, y]) => ({ x: x * window.width, y: y * window.height }));
          const first = points[0];
          if (points.length === 1 && first) return <View key={s} style={[styles.dot, { left: first.x - 5, top: first.y - 5, width: 10, height: 10, backgroundColor: color }]} />;
          return points.slice(1).map((to, i) => { const from = points[i]; return from ? <Segment key={`${s}-${i}`} from={from} to={to} color={color} /> : null; });
        })}
      </View>
    );
  }
  // Element targets wait for their first measurement; an element that left the screen hides its mark.
  const target = item.kind === "highlight" ? { testID: item.testID } : item.target;
  const box: TargetRect | null | undefined = "testID" in target ? rect : { x: target.x * window.width - 24, y: target.y * window.height - 24, width: 48, height: 48 };
  if (!box) return null;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const name = "testID" in target ? target.testID : "this spot";
  if (item.kind === "highlight") {
    return <View testID="agent-overlay-highlight" pointerEvents="none" accessibilityLabel={`Agent highlight: ${name}`} style={[styles.highlight, { left: box.x - 4, top: box.y - 4, width: box.width + 8, height: box.height + 8 }]} />;
  }
  const shape = item.shape ?? "pointer";
  const below = center.y < window.height * 0.6;
  const a11y = `Agent ${shape === "pointer" ? "pointer" : shape}: ${item.label ?? name}`;
  if (shape === "circle") {
    const pad = 10, width = box.width + pad * 2, height = box.height + pad * 2;
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View testID="agent-overlay-circle" accessibilityLabel={a11y} pointerEvents="none" style={[styles.ring, { left: box.x - pad, top: box.y - pad, width, height, borderRadius: Math.max(width, height) / 2 }]} />
        {item.label ? <Label text={item.label} at={{ x: center.x, y: below ? box.y + box.height + pad : box.y - pad }} below={below} /> : null}
      </View>
    );
  }
  if (shape === "arrow") {
    // From the roomier side, ending just short of the element's edge.
    const tip = { x: center.x, y: below ? box.y + box.height + 6 : box.y - 6 };
    const tail = { x: Math.min(window.width - space.lg, Math.max(space.lg, tip.x + 40)), y: below ? tip.y + 90 : tip.y - 90 };
    const angle = Math.atan2(tail.y - tip.y, tail.x - tip.x);
    const head = (offset: number) => ({ x: tip.x + 18 * Math.cos(angle + offset), y: tip.y + 18 * Math.sin(angle + offset) });
    return (
      <View testID="agent-overlay-arrow" accessibilityLabel={a11y} pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Segment from={tail} to={tip} thickness={4} />
        <Segment from={tip} to={head(0.5)} thickness={4} />
        <Segment from={tip} to={head(-0.5)} thickness={4} />
        <View testID="agent-overlay-arrow-tip" pointerEvents="none" style={{ position: "absolute", left: tip.x - 1, top: tip.y - 1, width: 2, height: 2 }} />
        {item.label ? <Label text={item.label} at={tail} below={below} /> : null}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View testID="agent-overlay-pointer" accessibilityLabel={a11y} pointerEvents="none" style={[styles.halo, { left: center.x - 18, top: center.y - 18 }]}>
        <View style={styles.core} />
      </View>
      {item.label ? <Label text={item.label} at={{ x: center.x, y: below ? center.y + 18 : center.y - 18 }} below={below} /> : null}
    </View>
  );
}

function targetOf(item: OverlayItem): string | undefined {
  if (item.kind === "highlight") return item.testID;
  return item.kind === "point" && "testID" in item.target ? item.target.testID : undefined;
}

export function AgentControlLayer() {
  const activity = agentControl.use(s => s.activity);
  const items = agentControl.use(s => s.overlay.items);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rects, setRects] = useState<Readonly<Record<string, TargetRect | null>>>({});

  useEffect(() => {
    if (!activity) return;
    const timer = setTimeout(() => {
      if (agentControl.get().activity?.seq === activity.seq) dismissActivity();
    }, ACTIVITY_MS);
    return () => clearTimeout(timer);
  }, [activity]);

  // Expiry: one timer for the soonest mark; the reducer drops everything whose TTL ran out.
  useEffect(() => {
    if (items.length === 0) return;
    const next = Math.min(...items.map(item => item.createdAt + item.ttlMs));
    const timer = setTimeout(expireAgentMarks, Math.max(0, next - Date.now()) + 5);
    return () => clearTimeout(timer);
  }, [items]);

  useEffect(() => {
    const ids = [...new Set(items.map(targetOf).filter((id): id is string => id !== undefined))];
    if (ids.length === 0) { setRects({}); return; }
    let live = true;
    const measure = async () => {
      const found = await Promise.all(ids.map(async id => ({ id, rect: await measureAgentTarget(id, window) })));
      if (live) setRects(Object.fromEntries(found.map(({ id, rect }) => [id, rect])));
    };
    void measure();
    const timer = setInterval(() => void measure(), FOLLOW_MS);
    return () => { live = false; clearInterval(timer); };
  }, [items, window]);

  if (!activity && items.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      {items.map(item => {
        const id = targetOf(item);
        return <Mark key={item.id} item={item} rect={id === undefined ? undefined : rects[id]} window={window} />;
      })}
      {activity ? (
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
          <View testID="agent-activity" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.chip}>
            <Text testID="agent-activity-text" numberOfLines={2} style={[styles.text, activity.status !== "done" && styles.muted]}>{activity.text}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop agent control" onPress={() => setAgentControl(false)} style={styles.action}>
              <Text style={styles.stop}>Stop</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss agent activity" onPress={dismissAgentMarks} style={styles.action}>
              <Text style={styles.text}>✕</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 1000, elevation: 1000 },
  top: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: space.xs, maxWidth: 440, marginHorizontal: space.md,
    paddingLeft: space.md, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.gold,
  },
  text: { ...type.small, color: colors.ink, flexShrink: 1 },
  muted: { color: colors.ink2 },
  stop: { ...type.label, color: colors.gold },
  action: { minHeight: controlMin, minWidth: controlMin, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs },
  ring: { position: "absolute", borderWidth: STROKE, borderColor: MARK },
  highlight: { position: "absolute", borderWidth: STROKE, borderColor: MARK, borderRadius: radius.sm },
  halo: { position: "absolute", width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: MARK, alignItems: "center", justifyContent: "center" },
  core: { width: 12, height: 12, borderRadius: 6, backgroundColor: MARK },
  dot: { position: "absolute", borderRadius: 5 },
  label: { position: "absolute", maxWidth: 220, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: MARK },
  labelText: { ...type.small, color: colors.ink },
});
