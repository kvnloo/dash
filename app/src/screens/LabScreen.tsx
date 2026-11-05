import { DensityText as Text } from "../components/Density";
import { Children, memo, useCallback, useEffect, useMemo, useState, type ReactNode, type ReactElement } from "react";
import { FlashList } from "@shopify/flash-list";
import { StyleSheet, View } from "react-native";
import { OrbActivity } from "../components/OrbMotion";
import { fade } from "../motion";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { AgentOrb } from "../components/AgentOrb";
import type { OrbPhase } from "../lib/orb-phase";

const HERO_PHASES: OrbPhase[] = ["listening", "speaking", "thinking", "tool", "connecting", "idle"];
import { PressScale } from "../components/PressScale";
import { DensityPicker, useDensity } from "../components/Density";
import { TileGrid } from "../components/TileGrid";
import { InteractiveTile } from "../components/InteractiveTile";
import { ScreenHeader } from "../components/ScreenHeader";
import { ActionChip, type ChipVariant } from "../components/trace/ActionChip";
import { ReadStrip, type ReadVariant } from "../components/trace/ReadStrip";
import { StatTile, type StatVariant } from "../components/trace/StatTile";
import { TraceTimeline, type RowVariant } from "../components/trace/TraceTimeline";
import { LivePulse, tc } from "../components/trace/tokens";
import { haptic } from "../haptics";
import { inAppFeedbackEnabled } from "../lib/feedback";
import { submitInAppFeedback } from "../lib/feedback-submit";
import type { ScreenProps } from "../navigation";
import { store } from "../store/app";
import { activeSeries } from "../trace/model";
import { feedbackStore, latest, loadFeedback, record, traceStore } from "../trace/source";
import { colors, fonts, radius, space, type } from "../theme";

const SECTIONS = ["timeline", "lane-row", "read-strip", "action-chip", "stat-tile", "orb-states"] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Component lab: each trace component in isolation with 2–3 variants side by side.
 * "Pick" stores the choice (dash.trace.feedback/v1, kind lab_pick); "Send picks" files it
 * through the existing in-app feedback path.
 */
export function LabScreen({ navigation }: ScreenProps<"Lab">) {
  const { density, sizing } = useDensity();
  const snapshot = traceStore.use((s) => s.snapshot);
  const records = feedbackStore.use((s) => s.records);
  const settings = store.use((s) => s.settings);
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1]));
  const [stress, setStress] = useState(false);
  const [heroPhase, setHeroPhase] = useState<OrbPhase>("listening");
  const [replay, setReplay] = useState(0);
  const [sent, setSent] = useState(false);
  useEffect(() => { void loadFeedback(); }, []);

  const pick = useCallback((section: Section, variant: string) => { haptic.success(); record("lab_pick", section, variant); setSent(false); }, []);
  const picks = SECTIONS.map((s) => [s, latest(records, "lab_pick", s)] as const).filter(([, v]) => v);
  const send = () => {
    const text = `Trace lab picks: ${picks.map(([s, v]) => `${s}=${v}`).join(", ")}`;
    submitInAppFeedback({ kind: "typed", text });
    haptic.success();
    setSent(true);
  };

  const rowsSmall = useMemo(() => snapshot.rows.filter((r) => r.group !== "earlier").slice(0, 7), [snapshot]);
  const rowsLane = useMemo(() => snapshot.rows.filter((r) => r.key === "Dash · trace prototypes" || r.key === "Video · fframestudio"), [snapshot]);
  const series = useMemo(() => activeSeries(snapshot.rows, snapshot.now), [snapshot]);
  const action = snapshot.actions[0];
  const st = snapshot.stats;
  const P = (section: Section) => latest(records, "lab_pick", section);

  const items = useMemo(() => labItems(<>
        <View style={{ gap: 12 }}><Text style={styles.intro}>Compare every component in Compact, Comfortable and Rich. Tap Pick to save a variant on this phone.</Text>
          <InteractiveTile title="Gesture playground" summary="Tap opens detail. Double tap pins locally in this view. Triple tap copies this summary. Hold, slide and release selects a radial action; release in the centre cancels." testID="gesture-playground" style={{ marginHorizontal: 16, padding: sizing.padding, borderWidth: 1, borderColor: tc.rule, borderRadius: 14, backgroundColor: tc.raised }}>
            <Text style={styles.blockT}>Gesture playground</Text><Text style={styles.intro}>Tap: detail · 2×: pin locally · 3×: copy
Hold + slide: action wheel · centre: cancel</Text>
          </InteractiveTile></View>

        <Block title="Timeline" note="pinch · pan with momentum · hold to scrub" testID="lab-timeline">
          {(["bars", "density", "compact"] as RowVariant[]).map((v, i) => (
            <Variant key={v} letter={"ABC"[i] ?? ""} name={v} picked={P("timeline") === v} onPick={() => pick("timeline", v)}>
              <TraceTimeline snapshot={snapshot} rows={rowsSmall} variant={v} lanes={false} groups={false} testID={`lab-timeline-${v}`} />
            </Variant>
          ))}
        </Block>

        <Block title="Lane row" note="press for spring · live pulses" testID="lab-lane-row">
          {(["bars", "density", "compact"] as RowVariant[]).map((v, i) => (
            <Variant key={v} letter={"ABC"[i] ?? ""} name={v} picked={P("lane-row") === v} onPick={() => pick("lane-row", v)}>
              <TraceTimeline snapshot={snapshot} rows={rowsLane} variant={v} lanes={false} groups={false} testID={`lab-lane-${v}`} />
            </Variant>
          ))}
        </Block>

        <Block title="READ strip" note="how it arrives" action={{ label: "Replay", onPress: () => setReplay((r) => r + 1) }} testID="lab-read-strip">
          {(["slide", "words", "shimmer"] as ReadVariant[]).map((v, i) => (
            <Variant key={v} letter={"ABC"[i] ?? ""} name={v} picked={P("read-strip") === v} onPick={() => pick("read-strip", v)}>
              <View style={styles.pad}><ReadStrip text={snapshot.read} variant={v} replay={replay} /></View>
            </Variant>
          ))}
        </Block>

        {action ? (
          <Block title="Action chip" note="swipe to decide · Undo for 5 seconds" action={{ label: "Reset", onPress: () => { for (const v of ["card", "pill", "buttons"]) record("action", `lab-${v}`, "undo"); } }} testID="lab-action-chip">
            {(["card", "pill", "buttons"] as ChipVariant[]).map((v, i) => (
              <Variant key={v} letter={"ABC"[i] ?? ""} name={v} picked={P("action-chip") === v} onPick={() => pick("action-chip", v)}>
                <View style={styles.pad}>
                  <ActionChip action={{ ...action, id: `lab-${v}` }} variant={v} decision={latest(records, "action", `lab-${v}`)} decidedAt={records.find(r => r.kind === "action" && r.id === `lab-${v}`)?.at}
                    onDecide={(id, d) => record("action", id, d)} />
                </View>
              </Variant>
            ))}
          </Block>
        ) : null}

        <Block title="Stat tile" note="tap for detail · hold → Segment to cycle" action={{ label: "Replay", onPress: () => setReplay((r) => r + 1) }} testID="lab-stat-tile">
          <TileGrid inset={space.sm} gap={6}>
            {(["number", "meter", "spark"] as StatVariant[]).map((v, i) => (
              <View key={v} style={styles.sideCell}>
                <StatTile replay={replay} label="cut" value={st.cut} sub={`${st.resumed} resumed`} tone={tc.cut} variant={v}
                  segments={[{ n: st.resumed, color: tc.ok, label: "resumed" }, { n: st.cut - st.resumed, color: tc.cut, label: "not resumed" }]} series={series} />
                <PickBar letter={"ABC"[i] ?? ""} name={v} picked={P("stat-tile") === v} onPick={() => pick("stat-tile", v)} stacked />
              </View>
            ))}
          </TileGrid>
        </Block>

        <Block title="Orb states" note={stress ? "Stress: all 20 animated · shared clock" : "Visible only · at most 6 animated · shared clock"} action={{ label: stress ? "Cap at 6" : "Animate 20", onPress: () => setStress(value => !value) }} testID="lab-orb-states">
          {[20, 40, 64, 48].map((size, i) => (
            <Variant key={size} letter={"ABCD"[i] ?? ""} name={`${size}px`} picked={P("orb-states") === `${size}px`} onPick={() => pick("orb-states", `${size}px`)}>
              <View style={styles.orbRow}>
                {(["idle", "thinking", "tool", "streaming", "waiting-approval", "listening", "speaking", "connecting"] satisfies OrbPhase[]).map((phase) => (
                  <View key={phase} style={styles.orbCell}>
                    <AgentOrb thinking={{ phase: stress ? "thinking" : phase, tool: phase === "tool" ? "terminal" : undefined }} animated={stress || i < 2} size={size} label={stress ? "thinking stress orb" : phase} />
                    <Text style={styles.orbLabel} numberOfLines={1}>{stress ? "thinking" : phase === "waiting-approval" ? "approval" : phase}</Text>
                  </View>
                ))}
                <View style={styles.orbCell}><LivePulse size={Math.max(6, size / 5)} /><Text style={styles.orbLabel}>pulse</Text></View>
              </View>
            </Variant>
          ))}
        </Block>

        <Block title="Voice orb · hero" note="Live call phases at hero size · tap to cycle" action={{ label: heroPhase, onPress: () => setHeroPhase(p => HERO_PHASES[(HERO_PHASES.indexOf(p) + 1) % HERO_PHASES.length] ?? "listening") }} testID="lab-orb-hero">
          <View style={styles.heroOrb}><AgentOrb size="hero" thinking={{ phase: heroPhase, tool: heroPhase === "tool" ? "ask_z0" : undefined }} label={`hero ${heroPhase}`} /></View>
        </Block>

        <View style={styles.footer} testID="lab-picks">
          <Text style={styles.footT}>{picks.length ? picks.map(([s, v]) => `${s}: ${v}`).join(" · ") : "No picks yet"}</Text>
          {picks.length && inAppFeedbackEnabled(settings) ? (
            <PressScale onPress={send} scaleTo={0.95} style={styles.send} accessibilityRole="button" accessibilityLabel="Send picks">
              <Text style={styles.sendT}>{sent ? "Sent to Dash feedback ✓" : "Send picks"}</Text>
            </PressScale>
          ) : null}
        </View>
      </>), [snapshot, records, replay, sent, settings, pick, rowsSmall, rowsLane, series, density, sizing.padding, stress, heroPhase]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScreenHeader title="Component lab" compact onBack={() => navigation.goBack()} onAction={() => navigation.navigate("Trace")} action="Open trace" icon="activity" />
      <DensityPicker />
      <FlashList testID="lab-scroll" contentContainerStyle={styles.scroll} drawDistance={915}
        data={items} getItemType={(_item, index) => index}
        renderItem={({ item, index }) => <LabCell active={visible.has(index)}>{item}</LabCell>}
        onViewableItemsChanged={({ viewableItems }) => setVisible(new Set(viewableItems.flatMap(item => item.index === null ? [] : [item.index])))}
        extraData={visible} />
    </SafeAreaView>
  );
}

function labItems(fragment: ReactElement<{ children: ReactNode }>) { return Children.toArray(fragment.props.children); }

const LabCell = memo(function LabCell({ active, children }: { active: boolean; children: ReactNode }) {
  return <OrbActivity active={active}><View style={{ paddingBottom: space.xl }}>{children}</View></OrbActivity>;
});

function Block({ title, note, action, children, testID }: { title: string; note: string; action?: { label: string; onPress(): void }; children: ReactNode; testID: string }) {
  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.blockHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.blockT}>{title}</Text>
          <Text style={styles.blockN}>{note}</Text>
        </View>
        {action ? <PressScale onPress={action.onPress} scaleTo={0.92} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel={action.label}><Text style={styles.smallBtnT}>{action.label}</Text></PressScale> : null}
      </View>
      {children}
    </View>
  );
}

function Variant({ letter, name, picked, onPick, children }: { letter: string; name: string; picked: boolean; onPick(): void; children: ReactNode }) {
  return (
    <View style={[styles.variant, picked && styles.variantPicked]}>
      {children}
      <PickBar letter={letter} name={name} picked={picked} onPick={onPick} />
    </View>
  );
}

function PickBar({ letter, name, picked, onPick, stacked = false }: { letter: string; name: string; picked: boolean; onPick(): void; stacked?: boolean }) {
  return (
    <View style={[styles.pickBar, stacked && styles.pickStacked]}>
      <Text style={styles.pickName} numberOfLines={1}><Text style={styles.letter}>{letter}</Text> {name}</Text>
      <PressScale onPress={onPick} scaleTo={0.9} style={[styles.pick, picked && styles.pickOn]} accessibilityRole="button" accessibilityLabel={`Pick ${name}`} accessibilityState={{ selected: picked }}>
        {picked ? <Animated.Text entering={FadeIn.duration(fade.duration)} style={[styles.pickT, { color: colors.bg }]}>Picked</Animated.Text> : <Text style={styles.pickT}>Pick</Text>}
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 140, gap: space.xl },
  intro: { ...type.small, color: tc.text2, paddingHorizontal: space.lg },
  block: { gap: space.sm },
  blockHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg },
  blockT: { ...type.heading, color: tc.text },
  blockN: { fontFamily: fonts.mono, fontSize: 10, color: tc.text3 },
  smallBtn: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: tc.rule },
  smallBtnT: { fontFamily: fonts.mono, fontSize: 11, color: tc.text2 },
  variant: { marginHorizontal: space.sm, borderWidth: 1, borderColor: tc.rule, borderRadius: radius.md, overflow: "hidden" },
  variantPicked: { borderColor: tc.text },
  pad: { padding: space.md },
  pickBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingVertical: 6, borderTopWidth: 1, borderTopColor: tc.grid, gap: 6 },
  pickStacked: { flexDirection: "column", alignItems: "stretch", paddingHorizontal: 4 },
  pickName: { fontFamily: fonts.mono, fontSize: 11, color: tc.text2, flexShrink: 1 },
  letter: { color: tc.text, fontFamily: fonts.semibold },
  pick: { minWidth: 64, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: tc.barEdge, paddingHorizontal: 10 },
  pickOn: { backgroundColor: tc.text, borderColor: tc.text },
  pickT: { fontFamily: fonts.semibold, fontSize: 12, color: tc.text },
  sideCell: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: tc.rule, borderRadius: radius.md, padding: 4, gap: 4 },
  heroOrb: { alignItems: "center", paddingVertical: space.lg },
  orbRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", padding: space.md, rowGap: space.md },
  orbCell: { alignItems: "center", gap: 4, minWidth: 52 },
  orbLabel: { fontFamily: fonts.mono, fontSize: 9, color: tc.text3 },
  footer: { marginHorizontal: space.lg, gap: space.sm },
  footT: { fontFamily: fonts.mono, fontSize: 11, color: tc.text2 },
  send: { height: 44, borderRadius: radius.pill, backgroundColor: colors.accent },
  sendT: { fontFamily: fonts.semibold, fontSize: 14, color: colors.bg },
});
