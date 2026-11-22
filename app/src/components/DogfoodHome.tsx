import { memo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { haptic } from "../haptics";
import { FEEDBACK_STATUS_LABEL, feedbackConversation, feedbackLoopItems, type FeedbackLoopStatus } from "../lib/dogfood-home";
import { submitInAppFeedback } from "../lib/feedback-submit";
import { useRecordedSpeech } from "../lib/useRecordedSpeech";
import { setActive, store } from "../store/app";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";

const STATUS_COLOR: Record<FeedbackLoopStatus, string> = {
  unsent: colors.textMuted,
  sent: colors.textMuted,
  working: colors.gold,
  answered: colors.ok,
  failed: colors.danger,
};

/**
 * The view Dash opens on while in-app feedback is on: the self-development loop.
 * Typed or dictated notes go to the Dash secondmate as feedback (lib/feedback-submit.ts); the
 * list below shows each note and where its reply stands. Sending never retargets the chat the
 * Main composer is attached to.
 */
export const DogfoodHome = memo(function DogfoodHome({ onOpenThread, onOpenTab }: { onOpenThread(): void; onOpenTab(tab: number): void }) {
  const [draft, setDraft] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const address = store.use(s => s.settings?.address);
  const thread = store.use(s => feedbackConversation(s.conversations, s.settings?.address));
  const items = feedbackLoopItems(thread);
  const speech = useRecordedSpeech("dictation", transcript => {
    setSpoken(true);
    setDraft(current => (current.trim() ? current.trimEnd() + " " : "") + transcript);
  });
  const speechBusy = ["preparing", "recording", "transcribing"].includes(speech.state.phase);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    haptic.select();
    const attached = store.get().activeId;
    submitInAppFeedback({ kind: spoken ? "voice" : "typed", text });
    // The feedback thread is opened only on request; keep whatever chat Main was attached to.
    setActive(attached);
    setDraft("");
    setSpoken(false);
    setSentNote("Sent to Dash. It shows up below as it moves.");
  };

  return (
    <ScrollView testID="dogfood-home" style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>SELF-DEVELOPMENT LOOP</Text>
      <Text style={styles.lead}>Tell Dash what is off. What you type or say here goes to the Dash secondmate as feedback, and the fix hot-reloads on this preview.</Text>

      <View style={styles.card}>
        <TextInput
          value={draft}
          onChangeText={next => { setDraft(next); setSentNote(null); if (!next) setSpoken(false); }}
          placeholder="What is off?"
          placeholderTextColor={colors.textFaint}
          multiline
          style={styles.input}
          keyboardAppearance="dark"
          accessibilityLabel="Dash feedback"
        />
        {speech.state.note ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole={speech.state.phase === "error" ? "alert" : "text"}
            style={[styles.note, speech.state.phase === "error" && styles.error]}>{speech.state.note}</Text>
        ) : null}
        <View style={styles.row}>
          <PressScale accessibilityRole="button" accessibilityLabel={speechBusy ? "Stop feedback dictation" : "Dictate feedback"}
            onPress={() => { haptic.tap(); void (speechBusy ? speech.end() : speech.begin()); }} style={styles.secondary}>
            <Text style={styles.secondaryText}>{speechBusy ? "Stop" : "Speak"}</Text>
          </PressScale>
          <PressScale accessibilityRole="button" accessibilityLabel="Send feedback" accessibilityState={{ disabled: !draft.trim() || !address }}
            disabled={!draft.trim() || !address} onPress={send} style={[styles.primary, (!draft.trim() || !address) && styles.disabled]}>
            <Text style={styles.primaryText}>Send feedback</Text>
          </PressScale>
        </View>
        {sentNote ? <Text accessibilityLiveRegion="polite" style={styles.note}>{sentNote}</Text> : null}
      </View>

      <Text style={styles.section}>Your feedback</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>Nothing sent yet. Your notes and Dash's progress on them show up here.</Text>
      ) : (
        <View testID="dogfood-feedback-list" style={styles.list}>
          {items.map(item => (
            <View key={item.id} style={styles.item} accessible accessibilityLabel={`${item.text}. ${FEEDBACK_STATUS_LABEL[item.status]}`}>
              <Text style={styles.itemText} numberOfLines={2}>{item.text}</Text>
              <Text style={[styles.itemStatus, { color: STATUS_COLOR[item.status] }]}>{FEEDBACK_STATUS_LABEL[item.status]}</Text>
            </View>
          ))}
          <PressScale accessibilityRole="button" accessibilityLabel="Open the feedback thread" onPress={() => { haptic.select(); onOpenThread(); }} style={styles.link}>
            <Text style={styles.linkText}>Open the feedback thread</Text>
          </PressScale>
        </View>
      )}

      <View style={styles.row}>
        <PressScale accessibilityRole="button" accessibilityLabel="Open Orchestra" onPress={() => onOpenTab(2)} style={styles.secondary}>
          <Text style={styles.secondaryText}>Orchestra</Text>
        </PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel="Open Chats" onPress={() => onOpenTab(1)} style={styles.secondary}>
          <Text style={styles.secondaryText}>Chats</Text>
        </PressScale>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.md },
  kicker: { ...type.label, color: colors.gold },
  lead: { ...type.body, color: colors.textMuted },
  card: { backgroundColor: glass.fill, borderColor: glass.hair, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  input: { ...type.body, color: colors.text, minHeight: 88, textAlignVertical: "top", padding: 0 },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  primary: { minHeight: controlMin, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  primaryText: { ...type.heading, color: colors.onAccent },
  secondary: { minHeight: controlMin, minWidth: controlMin, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair2, alignItems: "center", justifyContent: "center" },
  secondaryText: { ...type.heading, color: colors.text },
  disabled: { opacity: 0.42 },
  note: { ...type.small, color: colors.textMuted },
  error: { color: colors.danger },
  section: { ...type.section, color: colors.text, marginTop: space.sm },
  empty: { ...type.small, color: colors.textMuted },
  list: { gap: space.sm },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.hair, paddingVertical: space.sm, gap: 2 },
  itemText: { ...type.body, color: colors.text },
  itemStatus: { ...type.small },
  link: { minHeight: controlMin, justifyContent: "center" },
  linkText: { ...type.label, color: colors.gold },
});
