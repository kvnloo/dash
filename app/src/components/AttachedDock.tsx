import { useEffect, useReducer, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { AgentPopup } from "./AgentPopup";
import { HarnessPicker } from "./HarnessPicker";
import { Composer } from "./Composer";
import { KeyboardDock } from "./KeyboardDock";
import { ShimmerText } from "./ShimmerText";
import { useSessionWorkers } from "./WorkersStrip";
import { canSteer } from "../lib/composer-mode";
import { PEEK_IDLE, peekTransition } from "../lib/attached-dock";
import { useLiveThinking } from "../lib/live-thinking";
import { useSessionActivity } from "../lib/session-activity";
import type { Conversation } from "../model";
import { bridge, sendChat } from "../net/bridge";
import { sendConversation } from "../net/send-conversation";
import { conversationBusy, conversationTargetError, createConversation, flushPendingSends, saveSettings, setActive, setQueueWaiting, stopConversation, store } from "../store/app";
import { actionable, approvals, itemTitle } from "../store/approvals";
import { attachedUi, showAttachedSearch } from "../store/attached-ui";
import { replyText, useKeyed } from "../store/text";
import { useHandedness } from "../lib/useHandedness";
import { colors, glass, radius, type } from "../theme";

type Props = { visible: boolean; onChat(): void; onSearch(): void; onVoice(): void; onApprovals(): void };

/** One mounted outside-chat input; navigation never retargets it or starts a new session. */
export function AttachedDock(props: Props) {
  const conversation = store.use(s => s.conversations.find(c => c.id === s.activeId));
  if (!conversation || !props.visible) return null;
  return <SessionDock key={conversation.id} {...props} conversation={conversation} />;
}

function SessionDock({ conversation, visible, onChat, onSearch, onVoice, onApprovals }: Props & { conversation: Conversation }) {
  const thumb = useHandedness();
  const settings = store.use(s => s.settings);
  const harnesses = store.use(s => s.connection.harnesses);
  const conversations = store.use(s => s.conversations);
  const search = attachedUi.use(s => s.search);
  const { thinking, caption, online, observed, streamingMessage } = useLiveThinking(conversation);
  useSessionActivity(settings, visible && online && conversation.harness === "hermes" && !streamingMessage, conversation.profileId, conversation.sessionId, conversation.targetHostId);
  const workers = useSessionWorkers(settings, visible && online && conversation.harness === "hermes", conversation.profileId, conversation.sessionId);
  const targetError = conversationTargetError(conversation);
  const [picker, setPicker] = useState(false);
  const [harnessPicker, setHarnessPicker] = useState(false);
  const [peek, dispatch] = useReducer(peekTransition, PEEK_IDLE);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const gate = approvals.use(s => s.items.find(i => actionable(i) && i.origin.session === conversation.sessionId && !snoozed.includes(i.id)));
  const lastUser = conversation.messages.findLast(m => m.role === "user");
  const lastReply = conversation.messages.findLast(m => m.role === "assistant");
  const text = useKeyed(replyText, lastReply?.turnId ?? "");
  const revision = `${lastUser?.id ?? ""}:${lastReply?.id ?? ""}:${lastReply?.state ?? ""}:${gate?.id ?? ""}`;
  useEffect(() => { if (visible) dispatch({ kind: "activity", revision, now: Date.now() }); }, [revision, visible]);
  useEffect(() => {
    if (!peek.expanded) return;
    const timer = setTimeout(() => dispatch({ kind: "tick", now: Date.now() }), Math.max(0, peek.until - Date.now()));
    return () => clearTimeout(timer);
  }, [peek.expanded, peek.until]);
  useEffect(() => {
    if (conversation.queueWaitForIdle && observed?.observed && observed.phase === "idle") {
      setQueueWaiting(conversation.id, false);
      if (online) flushPendingSends(sendChat);
    }
  }, [conversation.id, conversation.queueWaitForIdle, observed?.observed, observed?.phase, online]);
  const tuck = Gesture.Pan().activeOffsetY(12).runOnJS(true).onEnd(e => { if (e.translationY > 18) dispatch({ kind: "tuck" }); });
  const label = `${conversation.profileName ?? conversation.profileId ?? conversation.harness} · ${conversation.title}`;

  return <View style={!visible ? styles.hidden : undefined}>
    <KeyboardDock>
      <View style={[styles.identity, thumb.row]}>
        <AgentPopup conversation={conversation} thinking={thinking} onHarness={() => setHarnessPicker(true)} onApprovals={onApprovals} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Attached to ${label}. Switch session`} accessibilityHint="Long press for session actions" onPress={() => setPicker(true)} onLongPress={() => setPicker(true)} style={[styles.chip, thumb.row]}>
          <Text numberOfLines={1} style={styles.label}>{label}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={search ? "Return to attached conversation input" : "Search without detaching"} onPress={() => { showAttachedSearch(!search); if (!search) onSearch(); }} style={styles.button}><Text style={styles.action}>{search ? "Message" : "Search"}</Text></Pressable>
      </View>
      <View style={search ? styles.hidden : undefined}>
        <GestureDetector gesture={tuck}><View style={styles.peek}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open attached chat, ${caption}`} onPress={onChat} style={styles.status}>
            {thinking.phase !== "idle" ? <ShimmerText text={caption} size={11} /> : <Text style={styles.meta}>{caption}</Text>}
            {workers.length ? <Text style={styles.meta}>{workers.length} subagents</Text> : null}
          </Pressable>
          {peek.expanded ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Open full conversation" onPress={onChat}>
              {lastUser ? <Text numberOfLines={1} style={styles.user}>you · {lastUser.text || "Attachment"}</Text> : null}
              {lastReply ? <Text numberOfLines={2} style={styles.reply}>agent · {lastReply.error ?? (text || lastReply.text || caption)}</Text> : null}
            </Pressable>
            {gate ? <View><Text numberOfLines={1} style={styles.warn}>Needs OK · {itemTitle(gate)}</Text><View style={thumb.row}>
              <Pressable accessibilityRole="button" accessibilityLabel="Review approval before deciding" onPress={onApprovals} style={styles.button}><Text style={styles.action}>Review / Do…</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Not now, keep approval pending" onPress={() => setSnoozed(ids => [...ids, gate.id])} style={styles.button}><Text style={styles.meta}>Not now</Text></Pressable>
            </View></View> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Tuck conversation peek" onPress={() => dispatch({ kind: "tuck" })} style={styles.tuck}><Text style={styles.meta}>Tuck ↓</Text></Pressable>
          </> : null}
        </View></GestureDetector>
        {targetError ? <Text accessibilityRole="alert" style={styles.warn}>{targetError}</Text> : null}
        <Composer draftKey={conversation.id} disabled={!online || Boolean(targetError)} streaming={conversationBusy(conversation.id)} steerBusy={canSteer(conversation.harness, conversation.sessionId, thinking.phase, false)} harness={conversation.harness} cwd={conversation.cwd} placeholder={`Message ${conversation.profileName ?? conversation.harness}`}
          onSend={(value, attachments, mode = "queue") => { const accepted = sendConversation(conversation, value, attachments, mode, thinking.phase, Boolean(streamingMessage), sendChat); if (accepted) dispatch({ kind: "send", now: Date.now() }); return accepted; }}
          onStop={() => stopConversation(conversation.id, id => { bridge.send({ type: "cancel", id }); })} onVoice={onVoice} />
      </View>
    </KeyboardDock>
    <HarnessPicker visible={harnessPicker} harnesses={harnesses} selected={conversation.harness} onClose={() => setHarnessPicker(false)} onSelect={id => {
      if (settings) saveSettings({ ...settings, harness: id });
      if (id !== conversation.harness) createConversation(id);
    }} />
    <Modal visible={picker && visible} transparent animationType="none" onRequestClose={() => setPicker(false)}>
      <View style={styles.scrim}><View style={styles.sheet}>
        <Text style={styles.label}>Attached session</Text>
        <Pressable accessibilityRole="button" onPress={() => { setPicker(false); onChat(); }} style={styles.button}><Text style={styles.action}>Open chat</Text></Pressable>
        <ScrollView style={styles.sessions}>{conversations.slice(0, 20).map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: c.id === conversation.id }} onPress={() => { setActive(c.id); showAttachedSearch(false); setPicker(false); }} style={styles.button}><Text numberOfLines={1} style={c.id === conversation.id ? styles.action : styles.label}>{c.profileName ?? c.harness} · {c.title}</Text></Pressable>)}</ScrollView>
        <Pressable accessibilityRole="button" onPress={() => { setActive(null); showAttachedSearch(false); setPicker(false); onSearch(); }} style={styles.button}><Text style={styles.action}>Detach · New / search mode</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setPicker(false)} style={styles.button}><Text style={styles.meta}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  hidden: { display: "none" },
  identity: { alignItems: "center", gap: 6, paddingHorizontal: 12 },
  chip: { flex: 1, minWidth: 0, alignItems: "center", gap: 8, minHeight: 44 },
  label: { ...type.small, color: colors.text, flexShrink: 1 },
  action: { ...type.small, color: colors.gold },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  peek: { marginHorizontal: 12, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: glass.hair, backgroundColor: colors.bg },
  status: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 12 },
  meta: { ...type.mono, fontSize: 11, color: colors.textTertiary },
  user: { ...type.small, color: colors.textMuted },
  reply: { ...type.small, color: colors.text, paddingTop: 4 },
  warn: { ...type.small, color: colors.warn, paddingHorizontal: 12 },
  tuck: { minHeight: 30, alignItems: "flex-end", justifyContent: "center" },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.7)", padding: 16 },
  sheet: { padding: 12, backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.hair },
  sessions: { maxHeight: 300 },
});
