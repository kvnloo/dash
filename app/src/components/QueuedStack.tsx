import { useMemo, useState } from "react";
import { PanResponder, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { Conversation } from "../model";
import { queuedParts, queueMergeError, type QueuedPart } from "../lib/pending-queue";
import { useHandedness } from "../lib/useHandedness";
import { cancelQueuePreview, editQueued, moveQueued, previewQueued, removeQueued, setDeliverQueuedAsOne } from "../store/app";
import { MOTION_MS } from "../motion";
import { colors, glass, radius, type } from "../theme";
import { PressScale } from "./PressScale";

interface Props { conversation: Conversation; canSteer: boolean; onSteer(): void }

export function QueuedStack({ conversation, canSteer, onSteer }: Props) {
  const thumb = useHandedness();
  const [expanded, setExpanded] = useState(false);
  const parts = queuedParts(conversation);
  if (!parts.length) return null;
  const preview = conversation.queuePreview !== undefined;
  const mergeError = queueMergeError(conversation);
  return <Animated.View entering={FadeIn.duration(MOTION_MS.exit)} style={styles.stack}>
    <View style={[styles.header, thumb.row]}>
      <PressScale accessibilityRole="button" accessibilityLabel={`${parts.length} queued`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.hit}><Text style={styles.title}>{parts.length} queued {expanded ? "⌃" : "⌄"}</Text></PressScale>
      <View style={[styles.actions, thumb.row]}>
        <Action label="Merge" disabled={preview || Boolean(mergeError)} onPress={() => previewQueued(conversation.id)} />
        <Action label="Steer all now" disabled={!canSteer || preview || Boolean(mergeError)} onPress={onSteer} />
        <Action label="Clear" onPress={() => removeQueued(conversation.id)} />
      </View>
    </View>
    {mergeError ? <Text accessibilityRole="alert" style={styles.note}>{mergeError}</Text> : null}
    {expanded && !preview ? <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
      {parts.map((part, index) => <QueueItem key={part.assistant.turnId} part={part} index={index} count={parts.length} conversationId={conversation.id} />)}
    </ScrollView> : null}
    {preview ? <View style={[styles.header, thumb.row]}><Text style={styles.note}>Merge preview · edit below, then save</Text><Action label="Cancel merge" onPress={() => cancelQueuePreview(conversation.id)} /></View> : null}
    {expanded ? <PressScale accessibilityRole="switch" accessibilityLabel="Deliver queued as one message" accessibilityState={{ checked: conversation.deliverQueuedAsOne !== false }} onPress={() => setDeliverQueuedAsOne(conversation.id, conversation.deliverQueuedAsOne === false)} style={[styles.setting, thumb.row]}><Text style={styles.note}>Deliver queued as one message</Text><Text style={styles.title}>{conversation.deliverQueuedAsOne !== false ? "On" : "Off"}</Text></PressScale> : null}
  </Animated.View>;
}

function Action({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <PressScale accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.hit}><Text style={[styles.action, disabled && styles.disabled]}>{label}</Text></PressScale>;
}

function QueueItem({ part, index, count, conversationId }: { part: QueuedPart; index: number; count: number; conversationId: string }) {
  const thumb = useHandedness();
  const [dragging, setDragging] = useState(false);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => setDragging(true),
    onPanResponderRelease: (_event, gesture) => {
      setDragging(false);
      moveQueued(conversationId, index, Math.max(0, Math.min(count - 1, index + Math.round(gesture.dy / 88))));
    },
    onPanResponderTerminate: () => setDragging(false),
  }), [conversationId, index, count]);
  return <View style={[styles.item, thumb.row, dragging && styles.dragging]}>
    <View {...pan.panHandlers} accessible accessibilityLabel={`Drag queued message ${index + 1}`} accessibilityHint="Drag up or down to reorder" accessibilityActions={[{ name: "increment", label: "Move down" }, { name: "decrement", label: "Move up" }]} onAccessibilityAction={event => moveQueued(conversationId, index, index + (event.nativeEvent.actionName === "increment" ? 1 : -1))} style={styles.handle}><Text style={styles.title}>⠿</Text><Text style={styles.note}>{index + 1}</Text></View>
    <TextInput accessibilityLabel={`Queued message ${index + 1}`} value={part.user.text} multiline style={styles.input} onChangeText={text => editQueued(conversationId, part.assistant.turnId, text)} />
    <PressScale accessibilityRole="button" accessibilityLabel={`Delete queued message ${index + 1}`} onPress={() => removeQueued(conversationId, part.assistant.turnId)} style={styles.hit}><Text style={styles.action}>×</Text></PressScale>
  </View>;
}

const styles = StyleSheet.create({
  stack: { marginHorizontal: 12, marginTop: 6, borderWidth: 1, borderColor: glass.hair, borderRadius: radius.card, backgroundColor: colors.bg },
  header: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 },
  actions: { alignItems: "center" },
  hit: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  title: { ...type.mono, color: colors.text, fontSize: 12 },
  action: { ...type.mono, color: colors.gold, fontSize: 11 },
  note: { ...type.mono, color: colors.textTertiary, fontSize: 10 },
  disabled: { opacity: 0.35 },
  list: { maxHeight: 264 },
  item: { height: 88, alignItems: "center", borderTopWidth: 1, borderColor: glass.hair },
  dragging: { backgroundColor: glass.fillChipOn },
  handle: { width: 40, height: 88, justifyContent: "center", alignItems: "center" },
  input: { flex: 1, minWidth: 0, color: colors.text, ...type.body, fontSize: 13, maxHeight: 80 },
  setting: { paddingHorizontal: 12, minHeight: 44, alignItems: "center", justifyContent: "space-between" },
});
