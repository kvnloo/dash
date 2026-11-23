// DA-075: the Council card (port in meaning of Glide's councilPopup). The brief types onto the card,
// travels to each seat, each seat shows received/thinking/drafting/done from the recorded turns, and
// the replies converge into a report. Read aloud speaks the brief, then the report, through a full
// thinking-orb view; any tap returns to the card and "Back to the orb" resumes where it stopped.
// It draws a run the bridge read from disk, else a demo run under a visible DEMO tag; it never
// dispatches agents or invents a reply.
import * as Speech from "expo-speech";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { demoCouncilRun, parseCouncilRunReply, type CouncilRun } from "../../../shared/council-run";
import type { CouncilPosition, CouncilSession } from "../../../shared/council-session";
import { councilPositionWriter, councilSessionApi, type CouncilTarget } from "../lib/council-session";
import { executionToken } from "../lib/bridge-auth";
import { briefSpeech, councilAt, councilSentences, councilTiming, reportSpeech, type SeatState } from "../lib/council";
import { haptic } from "../haptics";
import { store } from "../store/app";
import { closeCouncil, council, type CouncilOrigin } from "../store/council";
import { colors, fonts, glass, radius, space, type } from "../theme";
import { AgentOrb } from "./AgentOrb";

const TICK_MS = 110;
type Source = { run: CouncilRun; live: boolean; from: string; note?: string };
type Reading = { kind: "brief" | "report"; sentences: string[]; index: number; passage?: string };

/** Root-mounted: renders nothing until the live call or a chat opens the council. */
export function CouncilHost(): React.JSX.Element | null {
  const open = council.use(s => s.open);
  const from = council.use(s => s.from);
  const opened = council.use(s => s.opened);
  const target = council.use(s => s.target);
  if (!open) return null;
  return <CouncilPicker key={opened} from={from} target={target} />;
}

function CouncilPicker({ from, target }: { from: CouncilOrigin; target?: CouncilTarget }) {
  const settings = store.use(s => s.settings);
  const api = useMemo(() => settings && target ? councilSessionApi(settings, target) : undefined, [settings, target]);
  const [saved, setSaved] = useState<CouncilSession>();
  const [rows, setRows] = useState<Awaited<ReturnType<NonNullable<typeof api>["list"]>>>();
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    active.current = controller;
    void api.list(controller.signal).then(
      list => { if (!controller.signal.aborted) setRows(list); },
      error => { if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : "Could not list saved councils."); },
    );
    return () => controller.abort();
  }, [api]);
  const load = async (id: string) => {
    const controller = active.current;
    if (!api || !controller || loading) return;
    setLoading(true); setProblem("");
    try {
      const record = await api.load(id, controller.signal);
      if (!controller.signal.aborted) setSaved(record);
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : "Could not open this saved council.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  if (saved && api) return <CouncilPanel key={saved.council_id} from={from} saved={saved} api={api} />;
  return <CouncilPanel from={from} picker={api ? <View style={styles.seats}>
    <Text accessibilityRole="header" style={styles.micro}>SAVED COUNCILS IN THIS CHAT</Text>
    {problem ? <Text accessibilityRole="alert" style={styles.small}>{problem}</Text> : null}
    {!rows && !problem ? <Text style={styles.small}>Looking for saved councils…</Text> : null}
    {rows?.length === 0 ? <Text style={styles.small}>No saved councils in this chat.</Text> : null}
    {rows?.map(row => <Pressable key={row.id} testID={row.id} accessibilityRole="button" disabled={loading}
      onPress={() => void load(row.id)} style={styles.secondary}>
      <Text style={styles.secondaryText}>{row.live ? "" : "DEMO · "}{row.brief}</Text>
    </Pressable>)}
    {loading ? <Text style={styles.small}>Opening saved council…</Text> : null}
  </View> : undefined} />;
}

function storedReading(saved: CouncilSession, key: string | null, index: number): Reading | null {
  const passage = saved.passages.find(p => p.key === key);
  if (!passage) return null;
  // Match Glide’s sentence boundaries exactly: sentence indices are on the wire.
  const sentences = passage.text.match(/[^.!?]+[.!?]+(?:["']|$)?|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
  return { kind: key === "brief" ? "brief" : "report", passage: passage.key, sentences, index };
}

function useCouncilSource(skip: boolean): Source | null {
  const settings = store.use(s => s.settings);
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    const demo = (note?: string): Source => ({ run: demoCouncilRun(), live: false, from: "synthetic seats and brief", ...(note ? { note } : {}) });
    if (!settings) { setSource(demo("Pair with your computer to read its council.")); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void (async () => {
      try {
        const response = await fetch(`http://${settings.address}/council/run`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reply = parseCouncilRunReply(await response.json());
        if (live) setSource(reply.run ? { run: reply.run, live: true, from: reply.from } : demo(`${reply.reason}; showing the demo run.`));
      } catch {
        if (live) setSource(demo("The council on your computer could not be read; showing the demo run."));
      } finally { clearTimeout(timeout); }
    })();
    return () => { live = false; controller.abort(); clearTimeout(timeout); };
  }, [settings?.address, settings?.token, skip]);
  return source;
}

function CouncilPanel({ from, saved, api, picker }: {
  from: CouncilOrigin; saved?: CouncilSession; api?: ReturnType<typeof councilSessionApi>; picker?: React.ReactNode;
}): React.JSX.Element {
  const local = useCouncilSource(Boolean(saved));
  const source = saved ?? local;
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [start, setStart] = useState<number | null>(() => saved ? now - saved.position.elapsed_ms : null);
  // While a reading plays the exchange clock holds, so nothing moves on under the orb.
  const [held, setHeld] = useState<{ elapsed: number; since: number } | null>(null);
  const [readAloud, setReadAloud] = useState(saved?.position.read_aloud ?? false);
  const [muted, setMuted] = useState(saved?.position.muted ?? false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState<Reading | null>(null);
  const [status, setStatus] = useState("");
  const read = useRef({ brief: false, report: false });
  const generation = useRef(0);
  const [syncProblem, setSyncProblem] = useState("");
  const position = useRef<CouncilPosition | undefined>(saved?.position);
  const [write] = useState(() => saved && api ? councilPositionWriter(api, saved, setSyncProblem) : undefined);
  const initial = useRef(true);
  const run = source?.run;
  const timing = useMemo(() => run ? councilTiming(run, reduce, Boolean(saved)) : null, [run, reduce, saved]);
  const elapsed = start === null ? null : held ? held.elapsed : Math.min(timing?.total ?? 0, now - start);
  const view = run ? councilAt(run, elapsed, reduce, Boolean(saved)) : null;
  const playing = start !== null && view?.phase !== "done";

  useEffect(() => {
    if (start === null || held || !timing || reduce) return;
    if (now - start >= timing.total) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [start, held, timing, reduce, now - (start ?? 0) >= (timing?.total ?? 0)]);

  const heldRef = useRef<{ elapsed: number; since: number } | null>(null);
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const publish = useCallback((patch: Partial<CouncilPosition> = {}) => {
    if (!position.current) return;
    const prior = position.current;
    const elapsed = reduce ? prior.elapsed_ms : Math.max(prior.elapsed_ms, elapsedRef.current ?? 0);
    const next = { ...prior, elapsed_ms: Math.round(elapsed), ...patch };
    position.current = next;
    void write?.(next);
  }, [write, reduce]);
  const hold = useCallback(() => {
    if (heldRef.current) return;
    heldRef.current = { elapsed: elapsedRef.current ?? 0, since: Date.now() };
    setHeld(heldRef.current);
  }, []);
  const release = useCallback(() => {
    const h = heldRef.current;
    if (!h) return;
    heldRef.current = null;
    setHeld(null);
    setStart(s => s === null ? s : s + (Date.now() - h.since));
    setNow(Date.now());
  }, []);
  const stopSpeech = useCallback(() => { generation.current += 1; Speech.stop(); setSpeaking(false); }, []);

  const speakFrom = useCallback((next: Reading) => {
    const mine = ++generation.current;
    setReading(next);
    setPaused(null);
    hold();
    const sentence = next.sentences[next.index];
    const advancePassage = () => {
      if (!saved || !next.passage || next.passage === "brief") return false;
      const at = saved.passages.findIndex(p => p.key === next.passage);
      const after = storedReading(saved, saved.passages[at + 1]?.key ?? null, 0);
      if (!after) return false;
      speakFrom(after);
      return true;
    };
    if (sentence === undefined) {
      if (!advancePassage()) { setReading(null); setSpeaking(false); release(); }
      return;
    }
    if (next.passage) publish({ passage: next.passage, sentence: next.index });
    setStatus(current => current || "Preparing speech…");
    Speech.speak(sentence, {
      onStart: () => { if (generation.current !== mine) return; setStatus(""); setSpeaking(true); },
      onDone: () => {
        if (generation.current !== mine) return;
        if (next.passage) publish({ passage: next.passage, sentence: Math.min(999, next.index + 1) });
        if (next.index + 1 < next.sentences.length && (!next.passage || next.index < 999)) speakFrom({ ...next, index: next.index + 1 });
        else if (!advancePassage()) { generation.current += 1; setReading(null); setSpeaking(false); release(); }
      },
      onError: () => {
        if (generation.current !== mine) return;
        generation.current += 1;
        setReading(null); setSpeaking(false); setReadAloud(false); if (saved) setPaused(next); release();
        publish({ read_aloud: false });
        setStatus("Read aloud failed on this device. The council stays available as text.");
      },
    });
  }, [hold, release, saved, publish]);

  // Read aloud: the brief once it is written, the report once it is complete.
  useEffect(() => {
    if (!run || !view) return;
    if (saved && initial.current) {
      initial.current = false;
      const pos = saved.position;
      const t = councilTiming(run, false, true);
      read.current = { brief: pos.passage !== null || pos.elapsed_ms >= t.working, report: pos.passage !== null && pos.passage !== "brief" };
      const next = storedReading(saved, pos.passage, pos.sentence);
      if (next) {
        if (readAloud && !muted) speakFrom(next);
        else setPaused(next);
        return;
      }
    }
    if (!readAloud || muted || reading || paused) return;
    if (!read.current.brief && (view.phase === "sending" || (reduce && view.phase === "done"))) {
      read.current.brief = true;
      const next = saved ? storedReading(saved, "brief", 0) : { kind: "brief" as const, sentences: councilSentences(briefSpeech(run)), index: 0 };
      if (next) speakFrom(next);
    } else if (read.current.brief && !read.current.report && view.phase === "done") {
      read.current.report = true;
      const next = saved ? storedReading(saved, saved.passages[1]?.key ?? null, 0) : { kind: "report" as const, sentences: councilSentences(reportSpeech(run)), index: 0 };
      if (next) speakFrom(next);
    }
  }, [run, view?.phase, readAloud, muted, reading, paused, reduce, speakFrom, saved]);

  useEffect(() => () => { generation.current += 1; Speech.stop(); }, []);

  /** Any tap on the orb: cancel this sentence, keep the place, show the card. */
  const returnToCard = () => {
    haptic.select();
    stopSpeech();
    if (reading) setPaused(reading);
    setReading(null);
    release();
    publish();
  };
  const resume = () => { if (paused) { haptic.select(); speakFrom(paused); } };
  const convene = () => {
    if (!run || playing) return;
    haptic.tap();
    stopSpeech();
    setReading(null); setPaused(null); heldRef.current = null; setHeld(null); setStatus("");
    read.current = { brief: false, report: false };
    const t = Date.now();
    setStart(t); setNow(t);
    publish({ elapsed_ms: 0, passage: null, sentence: 0 });
  };
  const toggleRead = () => {
    haptic.select();
    if (readAloud) { stopSpeech(); setReading(null); setPaused(saved ? reading ?? paused : null); release(); }
    else if (saved && paused && !muted) speakFrom(paused);
    // Turning it on after the run finished reads the report now.
    else if (view?.phase === "done") read.current = { brief: true, report: false };
    setReadAloud(!readAloud);
    publish({ read_aloud: !readAloud });
  };
  const toggleMute = () => {
    haptic.select();
    if (!muted) { stopSpeech(); if (reading) setPaused(reading); setReading(null); release(); }
    setMuted(!muted);
    publish({ muted: !muted });
  };
  const close = () => { publish(); stopSpeech(); closeCouncil(); };

  const orb = Boolean(reading && speaking);
  const caption = reading?.sentences[reading.index] ?? "";
  return <Modal transparent visible animationType="none" onRequestClose={orb ? returnToCard : close} statusBarTranslucent>
    <View style={[styles.backdrop, orb && styles.backdropOrb, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.sm }]} testID="council-modal">
      {orb && reading ? <Pressable testID="council-orb-view" accessibilityRole="button" accessibilityLabel="Return to council card" accessibilityHint="Stops reading aloud and shows the card" onPress={returnToCard} style={styles.orbView}>
        <Text style={styles.micro}>{reading.kind === "brief" ? "READING THE BRIEF" : "READING THE REPORT"} · {reading.index + 1}/{reading.sentences.length}</Text>
        <AgentOrb size="hero" thinking={{ phase: "speaking" }} animated={!reduce} label="Council reading aloud" />
        <Text testID="council-caption" accessibilityLiveRegion="polite" style={styles.caption} numberOfLines={3}>{caption}</Text>
        <Text style={styles.returnHint}>Tap anywhere to return to the card</Text>
      </Pressable> : <ScrollView testID="council-card" style={styles.card} contentContainerStyle={styles.cardBody} keyboardShouldPersistTaps="handled">
        {picker}
        {!run || !view || !source ? <Text style={styles.body}>Reading the council…</Text> : <>
          <View style={styles.row}>
            <Text style={styles.micro}>COUNCIL · {from === "z0live" ? "FROM THE LIVE CALL" : "FROM THIS CHAT"}</Text>
            <Text testID="council-source" accessibilityLabel={source.live ? `Live council read from ${source.from}` : "Demo council run"} style={[styles.tag, source.live ? styles.tagLive : null]}>{source.live ? `LIVE · ${source.from.toUpperCase()}` : "DEMO"}</Text>
          </View>
          <Text accessibilityRole="header" style={styles.title}>Council</Text>
          <Text style={styles.micro}>THE BRIEF</Text>
          <Text testID="council-brief" accessibilityLabel={`Brief: ${view.brief || "not written yet"}`} style={styles.brief}>{view.phase === "seated" ? run.brief : view.brief || " "}</Text>
          {(view.phase === "seated" ? run.constraints : view.constraints).map((line, i) => line ? <Text key={i} style={styles.constraint}>· {line}</Text> : null)}
          <View testID="council-verdict" style={[styles.verdict, view.phase === "done" && styles.verdictDone]}>
            <Text style={styles.verdictTitle}>{view.phase === "done" ? run.outcome ?? "The council has spoken" : start === null ? "The council is seated" : "The council is sitting"}</Text>
            <Text style={styles.small}>{view.phase === "done" ? tally(run) : `${run.seats.length} seats · ${run.rounds} rounds · reports appear as each seat finishes`}</Text>
          </View>
          <Text testID="council-narration" style={styles.narration}>{narration(view.phase, view.round)}</Text>
          <View style={styles.row}>
            <Pressable testID="council-convene" accessibilityRole="button" accessibilityLabel={playing ? "Convening the council" : start === null ? "Convene council" : "Replay the council"} accessibilityState={{ disabled: playing }} disabled={playing} onPress={convene} style={[styles.primary, playing && styles.disabled]}>
              <Text style={styles.primaryText}>{playing ? "Convening…" : start === null ? "Convene council →" : "Replay the council →"}</Text>
            </Pressable>
            <Pressable testID="council-close" accessibilityRole="button" accessibilityLabel="Close council" onPress={close} style={styles.secondary}><Text style={styles.secondaryText}>Close</Text></Pressable>
          </View>
          <View style={styles.row}>
            <Pressable testID="council-read-aloud" accessibilityRole="switch" accessibilityLabel="Read aloud" aria-checked={readAloud} onPress={toggleRead} style={[styles.secondary, readAloud && styles.on]}>
              <Text style={styles.secondaryText}>{readAloud ? "Read aloud: on" : "Read aloud"}</Text>
            </Pressable>
            <Pressable testID="council-mute" accessibilityRole="switch" accessibilityLabel="Mute council" aria-checked={muted} onPress={toggleMute} style={[styles.secondary, muted && styles.on]}>
              <Text style={styles.secondaryText}>{muted ? "Unmute" : "Mute"}</Text>
            </Pressable>
          </View>
          {paused && !muted && readAloud ? <Pressable testID="council-resume" accessibilityRole="button" accessibilityLabel={`Back to the orb, resume reading the ${paused.kind}`} onPress={resume} style={styles.secondary}>
            <Text style={styles.secondaryText}>Back to the orb · resume the {paused.kind} ({paused.index + 1}/{paused.sentences.length})</Text>
          </Pressable> : null}
          {syncProblem ? <Text accessibilityRole="alert" style={styles.small}>{syncProblem}</Text> : null}
          {status || local?.note ? <Text testID="council-status" accessibilityRole="alert" style={styles.small}>{status || local?.note}</Text> : null}
          <View testID="council-seats" style={styles.seats}>
            {run.seats.map((seat, i) => {
              const state = view.seats[i] ?? "waiting";
              const verdict = run.verdicts.find(v => v.seat === i);
              const done = state === "done";
              return <View key={seat.id} testID={`council-seat-${seat.id}`} accessibilityLabel={`${seat.name}, ${seat.family}, ${seatLabel(state)}${done && verdict ? `, ${verdict.stance}` : ""}`} style={styles.seat}>
                <AgentOrb size={22} thinking={{ phase: state === "thinking" || state === "drafting" ? "thinking" : "idle" }} animated={!reduce} label={`${seat.name} ${state}`} />
                <View style={styles.seatText}>
                  <View style={styles.seatHead}>
                    <Text style={styles.seatName}>{seat.name}</Text>
                    <Text style={styles.micro}>{seat.family.toUpperCase()}</Text>
                    <Text testID={`council-seat-state-${seat.id}`} style={[styles.state, state !== "waiting" && styles.stateOn]}>{seatLabel(state)}</Text>
                    {done && verdict ? <Text style={[styles.stance, verdict.stance === "dissent" && styles.dissent]}>{verdict.stance.toUpperCase()}</Text> : null}
                  </View>
                  <Text style={styles.small}>{done ? verdict?.text ?? "No report recorded" : state === "waiting" ? "Waiting for the brief" : "…"}</Text>
                </View>
              </View>;
            })}
          </View>
          {view.clauses.length ? <View testID="council-report" accessibilityLiveRegion="polite" style={styles.report}>
            <Text style={styles.micro}>THE REPORT</Text>
            {view.clauses.map(clause => <View key={clause.label} testID={`council-clause-${clause.label.toLowerCase()}`}>
              <Text style={styles.clauseLabel}>{clause.label.toUpperCase()}</Text>
              <Text style={styles.small}>{clause.text}</Text>
            </View>)}
          </View> : null}
          <Text style={styles.footer}>{source.live ? `Run read from ${source.from}. This card draws it and computes nothing.` : "Demo run with synthetic seats. Record a council on your computer to see a live one."}</Text>
        </>}
      </ScrollView>}
    </View>
  </Modal>;
}

function seatLabel(state: SeatState): string {
  return state === "waiting" ? "WAITING" : state === "received" ? "RECEIVED" : `RECEIVED · ${state.toUpperCase()}`;
}
function tally(run: CouncilRun): string {
  const n = (stance: string) => run.verdicts.filter(v => v.stance === stance).length;
  return `${n("agree")} of ${run.verdicts.length} agree · ${n("dissent")} dissent${n("abstain") ? ` · ${n("abstain")} abstain` : ""}`;
}
function narration(phase: string, round: number): string {
  switch (phase) {
    case "seated": return "Convene to send the brief to every seat.";
    case "brief": return "Writing the brief…";
    case "sending": return "Sending the brief to each seat…";
    case "working": return round ? `Round ${round}: the seats are drafting their reports.` : "The seats are thinking.";
    case "report": return "The reports are converging.";
    default: return "Every seat has reported.";
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", paddingHorizontal: space.md },
  // The orb owns the whole screen while it reads; nothing of the chat shows through.
  backdropOrb: { backgroundColor: colors.bg },
  card: { flex: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2, backgroundColor: colors.bg },
  cardBody: { padding: space.lg, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, flexWrap: "wrap" },
  micro: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: colors.textTertiary },
  tag: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: colors.textMuted, borderWidth: 1, borderColor: glass.hair2, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  tagLive: { color: colors.ok, borderColor: colors.ok },
  title: { ...type.title, color: colors.text },
  brief: { ...type.body, color: colors.text, minHeight: 48, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.hair2 },
  constraint: { ...type.small, color: colors.textMuted },
  verdict: { padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2, gap: 2 },
  verdictDone: { borderColor: colors.accent },
  verdictTitle: { ...type.cardTitle, color: colors.text },
  narration: { fontFamily: fonts.editorial, fontStyle: "italic", fontSize: 17, lineHeight: 22, color: colors.textMuted },
  primary: { flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: radius.md, backgroundColor: colors.accent, paddingHorizontal: space.lg },
  primaryText: { ...type.heading, color: colors.onAccent },
  disabled: { opacity: 0.55 },
  secondary: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2, paddingHorizontal: space.lg },
  secondaryText: { ...type.small, color: colors.textMuted },
  on: { borderColor: colors.accent },
  body: { ...type.body, color: colors.textMuted },
  small: { ...type.small, color: colors.textMuted },
  seats: { gap: 2, marginTop: space.sm },
  seat: { flexDirection: "row", gap: space.sm, alignItems: "flex-start", paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.hair },
  seatText: { flex: 1, minWidth: 0, gap: 2 },
  seatHead: { flexDirection: "row", alignItems: "baseline", gap: space.sm, flexWrap: "wrap" },
  seatName: { fontFamily: fonts.editorial, fontSize: 18, lineHeight: 22, color: colors.text },
  state: { fontFamily: fonts.mono, fontSize: 11, color: colors.textTertiary },
  stateOn: { color: colors.accent },
  stance: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: colors.ok, marginLeft: "auto" },
  dissent: { color: colors.danger },
  report: { gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.hair2 },
  clauseLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: colors.text },
  footer: { fontFamily: fonts.mono, fontSize: 11, color: colors.textFaint, textAlign: "center", marginTop: space.sm },
  orbView: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.xl, padding: space.xl },
  caption: { ...type.body, color: colors.text, textAlign: "center", maxWidth: 520 },
  returnHint: { ...type.small, color: colors.textFaint },
});
